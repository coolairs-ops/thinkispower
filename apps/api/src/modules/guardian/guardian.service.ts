import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { assertResourceAccess } from '../../common/utils/tenant-scope';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AcceptanceVerificationService, AcceptanceReport } from '../delivery/acceptance-verification.service';
import { loadRuoyiInstanceConfig } from '../app-runtime/ruoyi-provision.config';
import { smokeRuoyiConsole } from '../app-runtime/ruoyi-console-smoke';
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

  /** 对单个项目跑一次巡检：复用验收引擎(以 owner 身份) + 线上 liveness 真探活，落 GuardianCheck */
  async runCheck(projectId: string, trigger: 'scheduled' | 'manual' = 'scheduled') {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, orgId: true, productionUrl: true, backendRuntime: true },
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

    // 线上 liveness 真探活(修 #2)：守护必须打用户实际访问的 productionUrl，
    // 而非只看库存 demoHtml + 平台健康。线上挂了即 critical，静态判定无法掩盖。
    // 若依控制台(kind=ruoyi&ready)：深探——经控制台代理 login+list(与交付上线门同口径)，
    // 否则只 GET 首页会被"SPA 首页 200 但后端断链/登不上去"骗过(浅探探不出真挂)。
    const liveness = project.productionUrl
      ? (this.isRuoyiConsole(project.backendRuntime)
          ? await this.probeRuoyiConsole(project.productionUrl, project.backendRuntime as any)
          : await this.probeLiveness(project.productionUrl))
      : null;
    if (liveness && !liveness.reachable) {
      this.logger.warn(`Guardian liveness 不可达 ${projectId}: ${project.productionUrl} → ${liveness.detail}`);
    }

    const { healthScore, status } = this.computeHealth(report, liveness);
    const check = await this.record(project, trigger, healthScore, status, report, liveness);

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

  /**
   * 健康分：有验收场景 → 通过率(0.7)+传感器分(0.3)；否则退到传感器分；都无 → unknown。
   * 线上 liveness 是硬信号(修 #2)：用户访问的 productionUrl 不可达 → 直接 critical(0)，
   * 静态验收/平台健康再高也不能掩盖"线上真挂了"。
   */
  computeHealth(
    report: AcceptanceReport | null,
    liveness?: { reachable: boolean; detail?: string } | null,
  ): { healthScore: number; status: string } {
    if (liveness && !liveness.reachable) {
      return { healthScore: 0, status: 'critical' };
    }
    let base: number | null = null;
    if (report?.hasScenarios && report.passRate != null) {
      const pass = report.passRate * 100;
      base = report.overallScore != null ? Math.round(pass * 0.7 + report.overallScore * 0.3) : Math.round(pass);
    } else if (report?.overallScore != null) {
      base = report.overallScore;
    }
    if (base == null) return { healthScore: 0, status: 'unknown' };
    const status = base >= HEALTHY_MIN ? 'healthy' : base >= DEGRADED_MIN ? 'degraded' : 'critical';
    return { healthScore: base, status };
  }

  /** 该项目是否以若依控制台为交付物且已就绪（决定深探 vs 浅探）。未配若依实例则退回浅探。 */
  private isRuoyiConsole(backendRuntime: unknown): boolean {
    const be = backendRuntime as { kind?: string; status?: string } | null;
    return be?.kind === 'ruoyi' && be?.status === 'ready' && loadRuoyiInstanceConfig().enabled;
  }

  /**
   * 若依控制台深探：经控制台 URL 代理 login + 首个业务资源 list 200（与交付上线门同口径）。
   * 真测"控制台→后端"连通，能抓出"首页 200 但代理断链/加密不匹配/登不上去"——浅探 GET 抓不出。
   */
  private async probeRuoyiConsole(
    url: string,
    desc: { resources?: string[]; initialUsers?: Array<{ userName: string; password: string }> },
  ): Promise<{ reachable: boolean; statusCode?: number; detail: string }> {
    const r = await smokeRuoyiConsole(url, desc, { timeoutMs: 10000 });
    return { reachable: r.ok, statusCode: r.statusCode, detail: `控制台冒烟: ${r.detail}` };
  }

  /** 线上 liveness 探活：GET productionUrl，5xx/网络错误=不可达 */
  private async probeLiveness(url: string): Promise<{ reachable: boolean; statusCode?: number; detail: string }> {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) });
      const reachable = res.status < 500;
      return { reachable, statusCode: res.status, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { reachable: false, detail: `不可达: ${e instanceof Error ? e.message : e}` };
    }
  }

  private async record(
    project: { id: string; orgId: string | null },
    trigger: 'scheduled' | 'manual',
    healthScore: number,
    status: string,
    report: AcceptanceReport | null,
    liveness?: { reachable: boolean; statusCode?: number; detail: string } | null,
  ) {
    const failedScenarios = (report?.scenarios ?? [])
      .filter((s) => s.status !== 'pass')
      .map((s) => `${s.scenarioName}(${s.status})`)
      .slice(0, 10);
    const detail: Record<string, unknown> = {};
    if (failedScenarios.length) detail.failedScenarios = failedScenarios;
    if (liveness) detail.liveness = liveness;
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
        detail: Object.keys(detail).length ? (detail as any) : undefined,
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
