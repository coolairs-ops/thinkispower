import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AcceptanceReport, AcceptanceVerificationService } from '../delivery/acceptance-verification.service';
import { DeliveryIterationService } from '../delivery/delivery-iteration.service';

/** 分级修复等级（风险从低到高的自主度，与之相反的人工介入度）：
 *  alert 提醒 · suggest 建议修复 · confirm 确认修复 · auto 低风险自动修复 */
export type RemediationLevel = 'alert' | 'suggest' | 'confirm' | 'auto';

const ACTION_TEXT: Record<RemediationLevel, string> = {
  alert: '巡检未取得有效结果，建议人工查看',
  suggest: '建议对未通过场景做定向修复（需人工触发）',
  confirm: '健康分严重下降，将生成修复方案，风险较高需人工确认后应用',
  auto: '健康分小幅下降且风险低，自动定向修复并以回滚点兜底',
};

/**
 * 守护分级修复（Phase 2）——本服务负责「定级 + 留痕」：
 * 巡检发现问题后按风险归到 4 级，落 GuardianRemediation（pending），等待应用（apply 在 increment 2）。
 * 定级保守：critical 一律 confirm（绝不自动改），只有小幅 degraded 且问题少才 auto。
 */
@Injectable()
export class GuardianRemediationService {
  private readonly logger = new Logger(GuardianRemediationService.name);

  constructor(
    private prisma: PrismaService,
    private acceptance: AcceptanceVerificationService,
    private iteration: DeliveryIterationService,
  ) {}

  /**
   * 按巡检结果定级（纯逻辑，便于单测）。
   * healthy → 无需修复(null)；unknown → alert；critical → confirm；
   * degraded → 小幅(≥80)且未通过≤1 → auto，否则 suggest。
   */
  classify(status: string, healthScore: number, failedCount: number): RemediationLevel | null {
    if (status === 'healthy') return null;
    if (status === 'unknown') return 'alert';
    if (status === 'critical') return 'confirm';
    // degraded
    return healthScore >= 80 && failedCount <= 1 ? 'auto' : 'suggest';
  }

  /**
   * 从一次巡检派生修复项并落库（pending）。健康或已有未结修复时跳过，避免每轮重复堆积。
   * 返回创建的修复记录 id，或 null（无需修复 / 去重跳过）。
   */
  async planFromCheck(input: {
    projectId: string;
    orgId: string | null;
    checkId: string;
    status: string;
    healthScore: number;
    report: AcceptanceReport | null;
  }): Promise<{ id: string; level: RemediationLevel } | null> {
    const failed = (input.report?.scenarios ?? []).filter((s) => s.status !== 'pass');
    const level = this.classify(input.status, input.healthScore, failed.length);
    if (!level) return null;

    // 去重：该项目已有未结(pending)修复则不再新建，待其处理完
    const existing = await this.prisma.guardianRemediation.findFirst({
      where: { projectId: input.projectId, status: 'pending' },
      select: { id: true },
    });
    if (existing) {
      this.logger.log(`项目 ${input.projectId} 已有未结修复 ${existing.id}，本轮跳过新建`);
      return null;
    }

    const failedNames = failed.map((s) => s.scenarioName).slice(0, 10);
    const issue =
      level === 'alert'
        ? `巡检未取得有效验收结果（健康分 ${input.healthScore}）`
        : `${failedNames.length} 个场景未通过：${failedNames.join('、') || '（健康分下降）'}`;

    const created = await this.prisma.guardianRemediation.create({
      data: {
        projectId: input.projectId,
        orgId: input.orgId ?? null,
        checkId: input.checkId,
        level,
        issue,
        proposedAction: ACTION_TEXT[level],
        status: 'pending',
        impactScope: { failedScenarios: failedNames, healthScore: input.healthScore },
      },
      select: { id: true },
    });
    this.logger.log(`守护分级修复 [${level}] 已记录 project=${input.projectId} remediation=${created.id}`);
    return { id: created.id, level };
  }

  /** 列出某项目的修复记录（最新优先） */
  async list(projectId: string) {
    return this.prisma.guardianRemediation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * 应用一条修复（四级共用机制，区别只在谁触发）：
   *   回滚点(快照当前) → 定向修复(带护栏) → 重验 → 劣化即回滚。
   * 低风险保证来自「重验劣化即回滚」兜底，而非区分修复策略。幂等：非 pending 直接返回。
   * alert 级无修复动作，直接标记 applied。
   */
  async apply(remediationId: string): Promise<{ status: string; before: number; after: number }> {
    const rem = await this.prisma.guardianRemediation.findUnique({ where: { id: remediationId } });
    if (!rem) throw new NotFoundException('修复记录不存在');
    if (rem.status !== 'pending') return { status: rem.status, before: 0, after: 0 };

    if (rem.level === 'alert') {
      await this.resolve(remediationId, 'applied', null, { note: '提醒级，无修复动作' });
      return { status: 'applied', before: 0, after: 0 };
    }

    const project = await this.prisma.project.findUnique({
      where: { id: rem.projectId },
      select: { id: true, userId: true, demoHtml: true },
    });
    if (!project?.demoHtml) {
      await this.resolve(remediationId, 'failed', null, { reason: 'demoHtml 为空，无法修复' });
      return { status: 'failed', before: 0, after: 0 };
    }
    const originalHtml = project.demoHtml;

    // 1. 回滚点：快照当前（待修）状态，记录 id 作 rollbackPointId
    const last = await this.prisma.demoSnapshot.findFirst({
      where: { projectId: project.id }, orderBy: { version: 'desc' }, select: { version: true },
    });
    const snap = await this.prisma.demoSnapshot.create({
      data: { projectId: project.id, html: originalHtml, source: 'manual_rollback', version: (last?.version ?? 0) + 1 },
      select: { id: true },
    });

    // 2. 修复前健康分
    const before = this.scoreOf(await this.safeVerify(project.userId, project.id));

    // 3. 定向修复（建议来自未通过场景；带退化护栏）
    const failed = (rem.impactScope as { failedScenarios?: string[] } | null)?.failedScenarios;
    const recommendations = (failed?.length ? failed : [rem.issue]).map((s) => `修复未通过/问题：${s}`);
    let newHtml: string | null = null;
    try {
      newHtml = await this.iteration.runTargetedFix(project.id, recommendations);
    } catch (e) {
      this.logger.warn(`守护修复生成失败 ${project.id}: ${e}`);
    }
    if (!newHtml) {
      await this.resolve(remediationId, 'failed', snap.id, { before, after: before, reason: '未生成有效修复' });
      return { status: 'failed', before, after: before };
    }

    // 4. 应用 + 重验
    await this.prisma.project.update({ where: { id: project.id }, data: { demoHtml: newHtml } });
    const after = this.scoreOf(await this.safeVerify(project.userId, project.id));

    // 5. 劣化即回滚（低风险保证）
    if (after < before) {
      await this.prisma.project.update({ where: { id: project.id }, data: { demoHtml: originalHtml } });
      this.logger.warn(`守护修复劣化 ${project.id}（${before}→${after}），已回滚`);
      await this.resolve(remediationId, 'rolled_back', snap.id, { before, after, improved: false });
      return { status: 'rolled_back', before, after };
    }

    this.logger.log(`守护修复已应用 ${project.id}（${before}→${after}）`);
    await this.resolve(remediationId, 'applied', snap.id, { before, after, improved: after > before });
    return { status: 'applied', before, after };
  }

  /** 验收引擎打分换算（与 GuardianService.computeHealth 同公式；内联避免循环依赖） */
  private scoreOf(report: AcceptanceReport | null): number {
    if (!report) return 0;
    if (report.hasScenarios && report.passRate != null) {
      const pass = report.passRate * 100;
      return report.overallScore != null ? Math.round(pass * 0.7 + report.overallScore * 0.3) : Math.round(pass);
    }
    return report.overallScore ?? 0;
  }

  private async safeVerify(userId: string, projectId: string): Promise<AcceptanceReport | null> {
    try {
      return await this.acceptance.verify(userId, null, projectId);
    } catch (e) {
      this.logger.warn(`守护重验失败 ${projectId}: ${e}`);
      return null;
    }
  }

  private async resolve(
    id: string,
    status: string,
    rollbackPointId: string | null,
    verifyResult: Record<string, unknown> | null,
  ): Promise<void> {
    await this.prisma.guardianRemediation.update({
      where: { id },
      data: {
        status,
        rollbackPointId: rollbackPointId ?? undefined,
        verifyResult: (verifyResult ?? undefined) as never,
        resolvedAt: new Date(),
      },
    });
  }
}
