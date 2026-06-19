import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** 月度报告里用到的巡检/修复最小形状（便于纯函数聚合与单测） */
interface CheckRow {
  healthScore: number;
  status: string;
  passRate: number | null;
  checkedAt: Date;
}
interface RemediationRow {
  level: string;
  issue: string;
  status: string;
  verifyResult: unknown;
  createdAt: Date;
}

export interface MonthlyHealthReport {
  period: { month: string; start: string; end: string };
  health: {
    avgScore: number | null;
    currentStatus: string;
    checkCount: number;
    avgPassRate: number | null; // 0-1
    statusDistribution: { healthy: number; degraded: number; critical: number; unknown: number };
  };
  trend: { label: string; avgScore: number | null }[];
  remediation: {
    total: number;
    byLevel: { alert: number; suggest: number; confirm: number; auto: number };
    outcome: { autoFixed: number; manualFixed: number; rolledBack: number; failed: number; pending: number };
    ledger: { date: Date; level: string; issue: string; status: string; before: number | null; after: number | null }[];
  };
  todos: string[];
}

/**
 * 守护月度健康报告（Phase 2）——把本月 GuardianCheck + GuardianRemediation 聚合成一份
 * 可给甲方的运营报告。聚合逻辑在纯函数 buildReport 里（无库可测）；monthly 负责按月查库。
 */
@Injectable()
export class GuardianReportService {
  constructor(private prisma: PrismaService) {}

  /** 按月生成报告。month 形如 'YYYY-MM'。 */
  async monthly(projectId: string, month: string): Promise<MonthlyHealthReport> {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) throw new BadRequestException('month 需形如 YYYY-MM');
    const year = Number(m[1]);
    const mon = Number(m[2]);
    if (mon < 1 || mon > 12) throw new BadRequestException('month 月份非法');
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end = new Date(Date.UTC(year, mon, 1));

    const [checks, remediations] = await Promise.all([
      this.prisma.guardianCheck.findMany({
        where: { projectId, checkedAt: { gte: start, lt: end } },
        select: { healthScore: true, status: true, passRate: true, checkedAt: true },
        orderBy: { checkedAt: 'asc' },
      }),
      this.prisma.guardianRemediation.findMany({
        where: { projectId, createdAt: { gte: start, lt: end } },
        select: { level: true, issue: true, status: true, verifyResult: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return this.buildReport(
      { month, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
      checks as CheckRow[],
      remediations as RemediationRow[],
    );
  }

  /** 纯聚合：把巡检与修复记录汇总成报告（无副作用，便于单测）。 */
  buildReport(
    period: { month: string; start: string; end: string },
    checks: CheckRow[],
    remediations: RemediationRow[],
  ): MonthlyHealthReport {
    const scored = checks.filter((c) => c.status !== 'unknown');
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

    const passRates = checks.map((c) => c.passRate).filter((p): p is number => p != null);
    const avgPassRate = passRates.length
      ? Math.round((passRates.reduce((a, b) => a + b, 0) / passRates.length) * 100) / 100
      : null;

    const dist = { healthy: 0, degraded: 0, critical: 0, unknown: 0 };
    for (const c of checks) {
      if (c.status in dist) dist[c.status as keyof typeof dist]++;
    }

    // 趋势：按当月第几周分桶（每 7 天一桶），桶内取有效巡检的平均健康分
    const buckets: number[][] = [[], [], [], [], []];
    for (const c of scored) {
      const day = new Date(c.checkedAt).getUTCDate();
      const wk = Math.min(4, Math.floor((day - 1) / 7));
      buckets[wk].push(c.healthScore);
    }
    const trend = buckets
      .map((b, i) => ({ label: `W${i + 1}`, avgScore: avg(b) }))
      .filter((t) => t.avgScore != null || false);
    // 至少保留有数据的周；全空时给空数组（前端显示"暂无趋势"）
    const trendOut = trend.length ? trend : [];

    const byLevel = { alert: 0, suggest: 0, confirm: 0, auto: 0 };
    const outcome = { autoFixed: 0, manualFixed: 0, rolledBack: 0, failed: 0, pending: 0 };
    const ledger = remediations.map((r) => {
      if (r.level in byLevel) byLevel[r.level as keyof typeof byLevel]++;
      if (r.status === 'applied') {
        if (r.level === 'auto') outcome.autoFixed++;
        else outcome.manualFixed++;
      } else if (r.status === 'rolled_back') outcome.rolledBack++;
      else if (r.status === 'failed') outcome.failed++;
      else if (r.status === 'pending') outcome.pending++;
      const vr = (r.verifyResult ?? {}) as { before?: number; after?: number };
      return {
        date: r.createdAt,
        level: r.level,
        issue: r.issue,
        status: r.status,
        before: vr.before ?? null,
        after: vr.after ?? null,
      };
    });

    const todos: string[] = [];
    for (const r of remediations) {
      if (r.status === 'pending') todos.push(`待处理[${r.level}]：${r.issue}`);
      else if (r.status === 'rolled_back') todos.push(`曾劣化回滚，建议人工根因诊断：${r.issue}`);
    }

    return {
      period,
      health: {
        avgScore: avg(scored.map((c) => c.healthScore)),
        currentStatus: checks.length ? checks[checks.length - 1].status : 'unknown',
        checkCount: checks.length,
        avgPassRate,
        statusDistribution: dist,
      },
      trend: trendOut,
      remediation: { total: remediations.length, byLevel, outcome, ledger },
      todos,
    };
  }
}
