import { GuardianReportService } from './guardian-report.service';

describe('GuardianReportService.buildReport（纯聚合）', () => {
  const service = new GuardianReportService(null as never);
  const period = { month: '2026-06', start: '2026-06-01', end: '2026-07-01' };

  const check = (day: number, healthScore: number, status: string, passRate: number | null) =>
    ({ healthScore, status, passRate, checkedAt: new Date(Date.UTC(2026, 5, day)) } as never);
  const rem = (level: string, status: string, before: number | null, after: number | null) =>
    ({ level, issue: `${level}问题`, status, verifyResult: before == null ? null : { before, after }, createdAt: new Date(Date.UTC(2026, 5, 10)) } as never);

  it('健康聚合：平均分剔除 unknown、当前状态取最后一条、通过率均值', () => {
    const r = service.buildReport(period, [
      check(2, 80, 'degraded', 0.8),
      check(9, 90, 'healthy', 1.0),
      check(16, 0, 'unknown', null), // unknown 不计入平均分
      check(28, 86, 'healthy', 0.9),
    ], []);

    expect(r.health.avgScore).toBe(Math.round((80 + 90 + 86) / 3)); // 85
    expect(r.health.currentStatus).toBe('healthy'); // 最后一条
    expect(r.health.checkCount).toBe(4);
    expect(r.health.avgPassRate).toBe(0.9); // (0.8+1.0+0.9)/3
    expect(r.health.statusDistribution).toEqual({ healthy: 2, degraded: 1, critical: 0, unknown: 1 });
  });

  it('趋势按周分桶取平均分', () => {
    const r = service.buildReport(period, [
      check(2, 80, 'degraded', null), // W1
      check(5, 82, 'degraded', null), // W1
      check(26, 86, 'healthy', null), // W4
    ], []);
    expect(r.trend).toEqual([
      { label: 'W1', avgScore: 81 },
      { label: 'W4', avgScore: 86 },
    ]);
  });

  it('修复台账：按级/按处置统计 + 前后分 + 待办', () => {
    const r = service.buildReport(period, [], [
      rem('auto', 'applied', 80, 86),       // 自动修复
      rem('suggest', 'applied', 75, 88),    // 人工修复
      rem('auto', 'rolled_back', 84, 79),   // 劣化回滚
      rem('alert', 'pending', null, null),  // 待办
    ]);

    expect(r.remediation.total).toBe(4);
    expect(r.remediation.byLevel).toEqual({ alert: 1, suggest: 1, confirm: 0, auto: 2 });
    expect(r.remediation.outcome).toEqual({ autoFixed: 1, manualFixed: 1, rolledBack: 1, failed: 0, pending: 1 });
    expect(r.remediation.ledger[0]).toMatchObject({ level: 'auto', status: 'applied', before: 80, after: 86 });
    expect(r.todos).toEqual([
      '曾劣化回滚，建议人工根因诊断：auto问题',
      '待处理[alert]：alert问题',
    ]);
  });

  it('空月份：全 0 / null，不报错', () => {
    const r = service.buildReport(period, [], []);
    expect(r.health.avgScore).toBeNull();
    expect(r.health.currentStatus).toBe('unknown');
    expect(r.trend).toEqual([]);
    expect(r.remediation.total).toBe(0);
    expect(r.todos).toEqual([]);
  });
});
