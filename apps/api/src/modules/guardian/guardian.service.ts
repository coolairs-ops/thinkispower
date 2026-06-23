import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { assertResourceAccess } from '../../common/utils/tenant-scope';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AcceptanceVerificationService, AcceptanceReport } from '../delivery/acceptance-verification.service';
import { GuardianRemediationService } from './guardian-remediation.service';
import { GuardianReportService } from './guardian-report.service';
import { GUARDIAN_QUEUE, GUARDIAN_SWEEP_JOB, GUARDIAN_CHECK_JOB } from './guardian.queue';

const HEALTHY_MIN = 90;
const DEGRADED_MIN = 70;
const DEFAULT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * 守护中心（Phase 2 最小闭环）。
 * 对已上线项目定时复用验收引擎跑关键场景，算健康分落 GuardianCheck；可手动触发、可查历史。
 * 「上线即入列」：sweep 自动把有 productionUrl 的项目标记 guardianEnabled。
 */
@Injectable()
export class GuardianService implements OnModuleInit {
  private readonly logger = new Logger(GuardianService.name);

  constructor(
    private prisma: PrismaService,
    private acceptance: AcceptanceVerificationService,
    private remediation: GuardianRemediationService,
    private report: GuardianReportService,
    private config: ConfigService,
    @InjectQueue(GUARDIAN_QUEUE) private queue: Queue,
  ) {}

  /** 注册定时巡检（repeatable，按 key 去重，重启安全） */
  async onModuleInit() {
    const every = Number(this.config.get('GUARDIAN_SWEEP_INTERVAL_MS', DEFAULT_SWEEP_INTERVAL_MS));
    try {
      await this.queue.add(GUARDIAN_SWEEP_JOB, {}, {
        repeat: { every },
        removeOnComplete: true,
        removeOnFail: 10,
      });
      this.logger.log(`Guardian 定时巡检已注册（每 ${Math.round(every / 3600000)}h）`);
    } catch (e) {
      this.logger.warn(`Guardian 定时巡检注册失败（Redis 不可用？）: ${e}`);
    }
  }

  /** 巡检扫描：所有已上线(productionUrl)项目 → 确保入列 → 返回待巡检 projectId 列表 */
  async listGuardianProjects(): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { productionUrl: { not: null } },
      select: { id: true, guardianEnabled: true },
    });
    const toEnroll = projects.filter((p) => !p.guardianEnabled).map((p) => p.id);
    if (toEnroll.length) {
      await this.prisma.project.updateMany({ where: { id: { in: toEnroll } }, data: { guardianEnabled: true } });
      this.logger.log(`Guardian 新入列 ${toEnroll.length} 个已上线项目`);
    }
    return projects.map((p) => p.id);
  }

  /** 对单个项目跑一次巡检：复用验收引擎(以 owner 身份)，落 GuardianCheck */
  async runCheck(projectId: string, trigger: 'scheduled' | 'manual' = 'scheduled') {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, orgId: true },
    });
    if (!project) {
      this.logger.warn(`Guardian 巡检跳过：项目 ${projectId} 不存在`);
      return null;
    }

    let report: AcceptanceReport | null = null;
    try {
      report = await this.acceptance.verify(project.userId, null, projectId);
    } catch (e) {
      this.logger.warn(`Guardian 巡检验收失败 ${projectId}: ${e}`);
    }

    const { healthScore, status } = report ? this.computeHealth(report) : { healthScore: 0, status: 'unknown' };
    const check = await this.record(project, trigger, healthScore, status, report);

    // 分级修复：按风险定级并留痕（pending）；auto 级当场自动应用（带快照/重验/回滚兜底），
    // 其余级别等人工触发。失败不影响巡检落库。
    try {
      const planned = await this.remediation.planFromCheck({
        projectId: project.id,
        orgId: project.orgId,
        checkId: check.id,
        status,
        healthScore,
        report,
      });
      if (planned?.level === 'auto') {
        await this.remediation.apply(planned.id);
      }
    } catch (e) {
      this.logger.warn(`Guardian 分级修复失败 ${projectId}: ${e}`);
    }

    return check;
  }

  /** 列出某项目的分级修复记录（ownership 校验） */
  async listRemediations(userId: string, orgId: string | null, projectId: string) {
    await this.assertOwner(userId, orgId, projectId);
    return this.remediation.list(projectId);
  }

  /** 人工触发应用一条修复（建议/确认级）（ownership 校验） */
  async applyRemediation(userId: string, orgId: string | null, projectId: string, remediationId: string) {
    await this.assertOwner(userId, orgId, projectId);
    return this.remediation.apply(remediationId);
  }

  /** 月度健康报告（ownership 校验）。month 形如 YYYY-MM */
  async monthlyReport(userId: string, orgId: string | null, projectId: string, month: string) {
    await this.assertOwner(userId, orgId, projectId);
    return this.report.monthly(projectId, month);
  }

  private async assertOwner(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);
  }

  /** 健康分：有验收场景 → 通过率(0.7)+传感器分(0.3)；否则退到传感器分；都无 → unknown */
  computeHealth(report: AcceptanceReport): { healthScore: number; status: string } {
    let base: number | null = null;
    if (report.hasScenarios && report.passRate != null) {
      const pass = report.passRate * 100;
      base = report.overallScore != null ? Math.round(pass * 0.7 + report.overallScore * 0.3) : Math.round(pass);
    } else if (report.overallScore != null) {
      base = report.overallScore;
    }
    if (base == null) return { healthScore: 0, status: 'unknown' };
    const status = base >= HEALTHY_MIN ? 'healthy' : base >= DEGRADED_MIN ? 'degraded' : 'critical';
    return { healthScore: base, status };
  }

  private async record(
    project: { id: string; orgId: string | null },
    trigger: 'scheduled' | 'manual',
    healthScore: number,
    status: string,
    report: AcceptanceReport | null,
  ) {
    const failedScenarios = (report?.scenarios ?? [])
      .filter((s) => s.status !== 'pass')
      .map((s) => `${s.scenarioName}(${s.status})`)
      .slice(0, 10);
    return this.prisma.guardianCheck.create({
      data: {
        projectId: project.id,
        orgId: project.orgId ?? null,
        healthScore,
        status,
        trigger,
        passRate: report?.passRate ?? null,
        overallScore: report?.overallScore ?? null,
        total: report?.total ?? 0,
        passed: report?.passed ?? 0,
        failed: report?.failed ?? 0,
        manual: report?.manual ?? 0,
        detail: failedScenarios.length ? { failedScenarios } : undefined,
      },
    });
  }

  /** 守护状态（最新 + 历史），带 ownership 校验 */
  async getStatus(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true, guardianEnabled: true, productionUrl: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    const checks = await this.prisma.guardianCheck.findMany({
      where: { projectId },
      orderBy: { checkedAt: 'desc' },
      take: 20,
    });
    return {
      enabled: project.guardianEnabled,
      deployed: !!project.productionUrl,
      latest: checks[0] ?? null,
      history: checks,
    };
  }

  /** 手动触发巡检：ownership 校验后入队（巡检本身较慢，异步执行，前端轮询状态） */
  async manualCheck(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    await this.queue.add(
      GUARDIAN_CHECK_JOB,
      { projectId, trigger: 'manual' },
      { attempts: 1, removeOnComplete: true, removeOnFail: 50 },
    );
    return { success: true, message: '巡检已启动，稍后刷新查看结果' };
  }
}
