import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GuardianService } from './guardian.service';
import { AcceptanceReport } from '../delivery/acceptance-verification.service';

const report = (over: Partial<AcceptanceReport>): AcceptanceReport => ({
  hasScenarios: true,
  passRate: 1,
  total: 0,
  passed: 0,
  failed: 0,
  manual: 0,
  overallScore: null,
  scenarios: [],
  verifiedAt: null,
  specVersion: null,
  ...over,
});

describe('GuardianService', () => {
  let service: GuardianService;
  let prisma: any;
  let acceptance: { verify: jest.Mock };
  let queue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      guardianCheck: { create: jest.fn((args) => Promise.resolve({ id: 'gc1', ...args.data })), findMany: jest.fn() },
    };
    acceptance = { verify: jest.fn() };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    const config = { get: (_: string, d?: any) => d } as any;
    const remediation = { planFromCheck: jest.fn().mockResolvedValue(null) } as any;
    const report = { monthly: jest.fn() } as any;
    service = new GuardianService(prisma, acceptance as any, remediation, report, config, queue as any);
  });

  describe('computeHealth', () => {
    it('有场景+传感器分 → 0.7 通过率 + 0.3 传感器分', () => {
      const r = service.computeHealth(report({ passRate: 1, overallScore: 80 }));
      expect(r.healthScore).toBe(Math.round(100 * 0.7 + 80 * 0.3)); // 94
      expect(r.status).toBe('healthy');
    });

    it('有场景无传感器分 → 仅通过率', () => {
      expect(service.computeHealth(report({ passRate: 0.8, overallScore: null }))).toEqual({ healthScore: 80, status: 'degraded' });
    });

    it('无场景但有传感器分 → 退到传感器分', () => {
      expect(service.computeHealth(report({ hasScenarios: false, passRate: null, overallScore: 65 }))).toEqual({ healthScore: 65, status: 'critical' });
    });

    it('既无场景又无传感器分 → unknown', () => {
      expect(service.computeHealth(report({ hasScenarios: false, passRate: null, overallScore: null }))).toEqual({ healthScore: 0, status: 'unknown' });
    });

    it('阈值：>=90 healthy / >=70 degraded / <70 critical', () => {
      expect(service.computeHealth(report({ passRate: 0.9, overallScore: null })).status).toBe('healthy');
      expect(service.computeHealth(report({ passRate: 0.7, overallScore: null })).status).toBe('degraded');
      expect(service.computeHealth(report({ passRate: 0.69, overallScore: null })).status).toBe('critical');
    });

    it('线上不可达 → 直接 critical(0)，覆盖高静态分(修 #2)', () => {
      expect(service.computeHealth(report({ passRate: 1, overallScore: 100 }), { reachable: false, detail: '不可达' }))
        .toEqual({ healthScore: 0, status: 'critical' });
    });

    it('线上可达 → 不改变正常评分', () => {
      expect(service.computeHealth(report({ passRate: 1, overallScore: 80 }), { reachable: true, detail: 'HTTP 200' }).status)
        .toBe('healthy');
    });
  });

  describe('runCheck', () => {
    it('项目不存在 → 返回 null，不验收', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      expect(await service.runCheck('p1')).toBeNull();
      expect(acceptance.verify).not.toHaveBeenCalled();
    });

    it('验收成功 → 以 owner 身份验收并落 GuardianCheck', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', userId: 'owner', orgId: 'org1' });
      acceptance.verify.mockResolvedValue(report({ passRate: 1, overallScore: 90, total: 3, passed: 3 }));
      const rec = await service.runCheck('p1', 'manual');
      expect(acceptance.verify).toHaveBeenCalledWith('owner', null, 'p1');
      expect(rec!.healthScore).toBe(97);
      expect(rec!.status).toBe('healthy');
      expect(rec!.trigger).toBe('manual');
      expect(rec!.orgId).toBe('org1');
    });

    it('验收抛错 → 记 unknown/0，不抛', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', userId: 'owner', orgId: null });
      acceptance.verify.mockRejectedValue(new Error('llm down'));
      const rec = await service.runCheck('p1');
      expect(rec!.status).toBe('unknown');
      expect(rec!.healthScore).toBe(0);
    });

    it('线上探活失败 → critical 落库，detail 记 liveness(修 #2)', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', userId: 'owner', orgId: null, productionUrl: 'http://live/app' });
      acceptance.verify.mockResolvedValue(report({ passRate: 1, overallScore: 95 }));
      const origFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
      try {
        const rec = await service.runCheck('p1');
        expect(rec!.status).toBe('critical');
        expect(rec!.healthScore).toBe(0);
        expect((rec!.detail as any).liveness.reachable).toBe(false);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('若依控制台项目 → 深探(代理 login+list)，登录通+list 200 → 不被判挂', async () => {
      const old = { b: process.env.RUOYI_BASE_URL, s: process.env.RUOYI_SRC_ROOT, c: process.env.RUOYI_CONSOLE_URL };
      process.env.RUOYI_BASE_URL = 'http://ruoyi:8080'; process.env.RUOYI_SRC_ROOT = '/src'; process.env.RUOYI_CONSOLE_URL = 'http://console:8089';
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', userId: 'owner', orgId: null, productionUrl: 'http://console:8089',
        backendRuntime: { kind: 'ruoyi', status: 'ready', resources: ['equipment'], initialUsers: [{ userName: 'u1', password: '123456' }] } });
      acceptance.verify.mockResolvedValue(report({ passRate: 1, overallScore: 95 }));
      const origFetch = global.fetch;
      const calls: string[] = [];
      global.fetch = jest.fn().mockImplementation((url: string) => {
        calls.push(url);
        if (url.includes('/auth/login')) return Promise.resolve({ status: 200, json: () => Promise.resolve({ code: 200, data: { access_token: 'tok' } }) });
        return Promise.resolve({ status: 200, json: () => Promise.resolve({ rows: [], total: 0 }) });
      }) as any;
      try {
        const rec = await service.runCheck('p1');
        expect(rec!.status).toBe('healthy'); // 深探通 → 不被判 critical
        expect(calls.some((u) => u.includes('/prod-api/auth/login'))).toBe(true); // 走控制台代理路径
        expect(calls.some((u) => u.includes('/system/equipment/list'))).toBe(true);
        expect((rec!.detail as any).liveness.detail).toContain('控制台冒烟');
      } finally {
        global.fetch = origFetch;
        if (old.b === undefined) delete process.env.RUOYI_BASE_URL; else process.env.RUOYI_BASE_URL = old.b;
        if (old.s === undefined) delete process.env.RUOYI_SRC_ROOT; else process.env.RUOYI_SRC_ROOT = old.s;
        if (old.c === undefined) delete process.env.RUOYI_CONSOLE_URL; else process.env.RUOYI_CONSOLE_URL = old.c;
      }
    });

    it('若依控制台项目 → 深探登录失败(首页 200 也骗不过) → critical', async () => {
      const old = { b: process.env.RUOYI_BASE_URL, s: process.env.RUOYI_SRC_ROOT, c: process.env.RUOYI_CONSOLE_URL };
      process.env.RUOYI_BASE_URL = 'http://ruoyi:8080'; process.env.RUOYI_SRC_ROOT = '/src'; process.env.RUOYI_CONSOLE_URL = 'http://console:8089';
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', userId: 'owner', orgId: null, productionUrl: 'http://console:8089',
        backendRuntime: { kind: 'ruoyi', status: 'ready', resources: ['equipment'], initialUsers: [] } });
      acceptance.verify.mockResolvedValue(report({ passRate: 1, overallScore: 95 }));
      const origFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({ code: 401 }) }) as any; // 首页/login 都 200 但 code 401
      try {
        const rec = await service.runCheck('p1');
        expect(rec!.status).toBe('critical');
        expect(rec!.healthScore).toBe(0);
      } finally {
        global.fetch = origFetch;
        if (old.b === undefined) delete process.env.RUOYI_BASE_URL; else process.env.RUOYI_BASE_URL = old.b;
        if (old.s === undefined) delete process.env.RUOYI_SRC_ROOT; else process.env.RUOYI_SRC_ROOT = old.s;
        if (old.c === undefined) delete process.env.RUOYI_CONSOLE_URL; else process.env.RUOYI_CONSOLE_URL = old.c;
      }
    });

    it('落库时摘要未通过场景', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', userId: 'owner', orgId: null });
      acceptance.verify.mockResolvedValue(report({
        passRate: 0.5, total: 2, passed: 1, failed: 1,
        scenarios: [{ scenarioName: '登录', status: 'pass' } as any, { scenarioName: '下单', status: 'fail' } as any],
      }));
      const rec = await service.runCheck('p1');
      expect(rec!.detail).toEqual({ failedScenarios: ['下单(fail)'] });
    });
  });

  describe('listGuardianProjects', () => {
    it('已上线但未入列的项目 → 自动入列', async () => {
      prisma.project.findMany.mockResolvedValue([
        { id: 'a', guardianEnabled: false },
        { id: 'b', guardianEnabled: true },
      ]);
      const ids = await service.listGuardianProjects();
      expect(prisma.project.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a'] } }, data: { guardianEnabled: true } });
      expect(ids).toEqual(['a', 'b']);
    });

    it('全部已入列 → 不调用 updateMany', async () => {
      prisma.project.findMany.mockResolvedValue([{ id: 'b', guardianEnabled: true }]);
      await service.listGuardianProjects();
      expect(prisma.project.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getStatus / manualCheck — ownership', () => {
    it('getStatus 非所有者 → 403', async () => {
      prisma.project.findUnique.mockResolvedValue({ userId: 'owner' });
      await expect(service.getStatus('attacker', null, 'p1')).rejects.toThrow(ForbiddenException);
    });

    it('getStatus 项目不存在 → 404', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('u', null, 'p1')).rejects.toThrow(NotFoundException);
    });

    it('getStatus 返回 enabled/deployed/latest/history', async () => {
      prisma.project.findUnique.mockResolvedValue({ userId: 'u', guardianEnabled: true, productionUrl: 'http://x' });
      prisma.guardianCheck.findMany.mockResolvedValue([{ id: 'gc2' }, { id: 'gc1' }]);
      const s = await service.getStatus('u', null, 'p1');
      expect(s).toEqual({ enabled: true, deployed: true, latest: { id: 'gc2' }, history: [{ id: 'gc2' }, { id: 'gc1' }] });
    });

    it('manualCheck 所有者 → 入队 manual 巡检', async () => {
      prisma.project.findUnique.mockResolvedValue({ userId: 'u' });
      const r = await service.manualCheck('u', null, 'p1');
      expect(queue.add).toHaveBeenCalledWith('guardian-check', { projectId: 'p1', trigger: 'manual' }, expect.objectContaining({ attempts: 1 }));
      expect(r.success).toBe(true);
    });

    it('manualCheck 非所有者 → 403，不入队', async () => {
      prisma.project.findUnique.mockResolvedValue({ userId: 'owner' });
      await expect(service.manualCheck('attacker', null, 'p1')).rejects.toThrow(ForbiddenException);
      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});
