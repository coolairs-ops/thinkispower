import { GuardianRemediationService } from './guardian-remediation.service';
import { AcceptanceReport } from '../delivery/acceptance-verification.service';

describe('GuardianRemediationService', () => {
  let service: GuardianRemediationService;
  let prisma: any;
  let acceptance: { verify: jest.Mock };
  let iteration: { runTargetedFix: jest.Mock };

  beforeEach(() => {
    prisma = {
      guardianRemediation: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      project: { findUnique: jest.fn(), update: jest.fn() },
      demoSnapshot: { findFirst: jest.fn().mockResolvedValue({ version: 3 }), create: jest.fn().mockResolvedValue({ id: 'snap-1' }) },
    };
    acceptance = { verify: jest.fn() };
    iteration = { runTargetedFix: jest.fn() };
    service = new GuardianRemediationService(prisma as never, acceptance as never, iteration as never);
  });

  // 验收报告工厂：用 overallScore 直接控前后健康分
  const reportScore = (overallScore: number): never =>
    ({ hasScenarios: false, passRate: null, total: 0, passed: 0, failed: 0, manual: 0, overallScore, scenarios: [] } as never);

  describe('classify（按风险定级，纯逻辑）', () => {
    it('healthy → 无需修复', () => {
      expect(service.classify('healthy', 95, 0)).toBeNull();
    });
    it('unknown → alert 提醒', () => {
      expect(service.classify('unknown', 0, 0)).toBe('alert');
    });
    it('critical → confirm（高风险，绝不自动改）', () => {
      expect(service.classify('critical', 60, 5)).toBe('confirm');
    });
    it('degraded 小幅(≥80)且未通过≤1 → auto 低风险自动修复', () => {
      expect(service.classify('degraded', 82, 1)).toBe('auto');
    });
    it('degraded 跌幅大或问题多 → suggest 建议修复', () => {
      expect(service.classify('degraded', 72, 3)).toBe('suggest');
      expect(service.classify('degraded', 88, 2)).toBe('suggest'); // 问题多
    });
  });

  describe('planFromCheck（定级 + 留痕）', () => {
    const report = (failedNames: string[]): AcceptanceReport =>
      ({
        hasScenarios: true,
        passRate: 0.7,
        total: 3,
        passed: 3 - failedNames.length,
        failed: failedNames.length,
        manual: 0,
        overallScore: 80,
        scenarios: failedNames.map((n) => ({ scenarioName: n, status: 'fail' })),
      } as never);

    it('健康项目不建修复记录', async () => {
      const r = await service.planFromCheck({
        projectId: 'p1', orgId: null, checkId: 'c1', status: 'healthy', healthScore: 95, report: report([]),
      });
      expect(r).toBeNull();
      expect(prisma.guardianRemediation.create).not.toHaveBeenCalled();
    });

    it('degraded 多问题 → 落一条 suggest，带影响范围', async () => {
      prisma.guardianRemediation.findFirst.mockResolvedValue(null);
      prisma.guardianRemediation.create.mockResolvedValue({ id: 'rem-1' });

      const r = await service.planFromCheck({
        projectId: 'p1', orgId: 'o1', checkId: 'c1', status: 'degraded', healthScore: 72, report: report(['登录场景', '下单场景', '导出场景']),
      });

      expect(r).toEqual({ id: 'rem-1', level: 'suggest' });
      const data = prisma.guardianRemediation.create.mock.calls[0][0].data;
      expect(data.level).toBe('suggest');
      expect(data.status).toBe('pending');
      expect(data.impactScope.failedScenarios).toEqual(['登录场景', '下单场景', '导出场景']);
      expect(data.impactScope.healthScore).toBe(72);
    });

    it('已有未结修复 → 跳过新建，避免每轮堆积', async () => {
      prisma.guardianRemediation.findFirst.mockResolvedValue({ id: 'rem-old' });

      const r = await service.planFromCheck({
        projectId: 'p1', orgId: null, checkId: 'c2', status: 'critical', healthScore: 60, report: report(['关键场景']),
      });

      expect(r).toBeNull();
      expect(prisma.guardianRemediation.create).not.toHaveBeenCalled();
    });
  });

  describe('apply（快照→修复→重验→劣化回滚）', () => {
    const pendingRem = (level = 'suggest') => ({
      id: 'rem-1', level, status: 'pending', projectId: 'p1',
      issue: '登录场景未通过', impactScope: { failedScenarios: ['登录场景'] },
    });

    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1', demoHtml: '<html>old</html>' });
    });

    it('修复后健康分提升 → applied，记录回滚点与前后分', async () => {
      prisma.guardianRemediation.findUnique.mockResolvedValue(pendingRem());
      acceptance.verify.mockResolvedValueOnce(reportScore(70)).mockResolvedValueOnce(reportScore(85)); // before 70 → after 85
      iteration.runTargetedFix.mockResolvedValue('<html>fixed</html>');

      const r = await service.apply('rem-1');

      expect(r).toEqual({ status: 'applied', before: 70, after: 85 });
      expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { demoHtml: '<html>fixed</html>' } });
      const upd = prisma.guardianRemediation.update.mock.calls[0][0].data;
      expect(upd.status).toBe('applied');
      expect(upd.rollbackPointId).toBe('snap-1');
      expect(upd.verifyResult).toEqual({ before: 70, after: 85, improved: true });
    });

    it('修复后劣化 → 回滚到原 HTML，标 rolled_back', async () => {
      prisma.guardianRemediation.findUnique.mockResolvedValue(pendingRem());
      acceptance.verify.mockResolvedValueOnce(reportScore(80)).mockResolvedValueOnce(reportScore(65)); // 80 → 65 劣化
      iteration.runTargetedFix.mockResolvedValue('<html>worse</html>');

      const r = await service.apply('rem-1');

      expect(r).toEqual({ status: 'rolled_back', before: 80, after: 65 });
      // 最后一次 project.update 把 demoHtml 还原为原文
      const lastUpd = prisma.project.update.mock.calls.at(-1)[0];
      expect(lastUpd.data.demoHtml).toBe('<html>old</html>');
      expect(prisma.guardianRemediation.update.mock.calls[0][0].data.status).toBe('rolled_back');
    });

    it('未生成有效修复 → failed', async () => {
      prisma.guardianRemediation.findUnique.mockResolvedValue(pendingRem());
      acceptance.verify.mockResolvedValue(reportScore(70));
      iteration.runTargetedFix.mockResolvedValue(null);

      const r = await service.apply('rem-1');
      expect(r.status).toBe('failed');
      expect(prisma.guardianRemediation.update.mock.calls[0][0].data.status).toBe('failed');
    });

    it('alert 级 → 无修复动作直接 applied', async () => {
      prisma.guardianRemediation.findUnique.mockResolvedValue(pendingRem('alert'));
      const r = await service.apply('rem-1');
      expect(r.status).toBe('applied');
      expect(iteration.runTargetedFix).not.toHaveBeenCalled();
    });

    it('非 pending → 幂等返回，不重复修复', async () => {
      prisma.guardianRemediation.findUnique.mockResolvedValue({ ...pendingRem(), status: 'applied' });
      const r = await service.apply('rem-1');
      expect(r.status).toBe('applied');
      expect(iteration.runTargetedFix).not.toHaveBeenCalled();
    });
  });
});
