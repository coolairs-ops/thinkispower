import { BuildOrchestratorService } from './build-orchestrator.service';

/** 内存假 prisma（只覆盖 buildModule/buildJournalEntry/$transaction），让 DAG/状态机/续跑测得真 */
function makeFakePrisma() {
  const modules: any[] = [];
  const journal: any[] = [];
  let idc = 0;
  return {
    _modules: modules,
    _journal: journal,
    buildModule: {
      count: async ({ where }: any) => modules.filter((m) => m.projectId === where.projectId).length,
      create: async ({ data }: any) => {
        const m = { id: 'm' + ++idc, result: null, status: 'pending', ...data };
        modules.push(m);
        return { ...m };
      },
      findMany: async ({ where, orderBy }: any) => {
        let r = modules.filter((m) => m.projectId === where.projectId);
        if (orderBy?.orderIdx === 'asc') r = [...r].sort((a, b) => a.orderIdx - b.orderIdx);
        return r.map((m) => ({ ...m }));
      },
      update: async ({ where, data }: any) => {
        const m = modules.find((x) => x.id === where.id);
        Object.assign(m, data);
        return { ...m };
      },
      updateMany: async ({ where, data }: any) => {
        let n = 0;
        for (const m of modules) {
          if (m.projectId === where.projectId && where.status?.in?.includes(m.status)) {
            Object.assign(m, data);
            n++;
          }
        }
        return { count: n };
      },
    },
    buildJournalEntry: {
      create: async ({ data }: any) => {
        const e = { id: 'j' + ++idc, ...data };
        journal.push(e);
        return { ...e };
      },
      findMany: async ({ where }: any) => journal.filter((e) => e.projectId === where.projectId),
    },
    $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
  };
}

const okRunner = { generate: async () => ({ ok: true }), test: async () => ({ passed: true }) };

describe('BuildOrchestratorService（自治建造回路）', () => {
  const PID = 'proj-1';
  let prisma: ReturnType<typeof makeFakePrisma>;

  const svc = (runner: any) => new BuildOrchestratorService(prisma as never, runner);

  beforeEach(() => {
    prisma = makeFakePrisma();
  });

  describe('plan', () => {
    it('落计划建模块 + 写 plan 日志；重复 plan 跳过（幂等）', async () => {
      const s = svc(okRunner);
      const r1 = await s.plan(PID, [{ name: 'A' }, { name: 'B', deps: ['A'] }]);
      expect(r1).toEqual({ created: 2, skipped: false });
      expect(prisma._modules).toHaveLength(2);
      expect(prisma._journal.some((e) => e.phase === 'plan')).toBe(true);

      const r2 = await s.plan(PID, [{ name: 'C' }]);
      expect(r2.skipped).toBe(true);
      expect(prisma._modules).toHaveLength(2); // 未新增
    });
  });

  describe('run（DAG 遍历 + 状态机）', () => {
    it('按依赖就绪顺序建造，全部 done，A 先于其依赖者', async () => {
      const s = svc(okRunner);
      await s.plan(PID, [{ name: 'A' }, { name: 'B', deps: ['A'] }, { name: 'C', deps: ['A'] }]);

      const res = await s.run(PID);
      expect(res).toMatchObject({ done: 3, blocked: 0, pending: 0, total: 3 });

      // 完成顺序：A 的 done 日志在 B/C 之前（依赖先行）
      const doneOrder = prisma._journal.filter((e) => e.phase === 'done').map((e) => e.summary);
      const idxA = doneOrder.findIndex((s) => s.includes('A'));
      const idxB = doneOrder.findIndex((s) => s.includes('B'));
      expect(idxA).toBeGreaterThanOrEqual(0);
      expect(idxA).toBeLessThan(idxB);
    });

    it('生成失败 → 模块 blocked，其依赖者因不就绪而停在 pending', async () => {
      const runner = {
        generate: async (_p: string, m: any) => (m.name === 'A' ? { ok: false, summary: 'LLM 挂了' } : { ok: true }),
        test: async () => ({ passed: true }),
      };
      const s = svc(runner);
      await s.plan(PID, [{ name: 'A' }, { name: 'B', deps: ['A'] }]);

      const res = await s.run(PID);
      expect(res).toMatchObject({ done: 0, blocked: 1, pending: 1, total: 2 });
      expect(prisma._modules.find((m) => m.name === 'A').status).toBe('blocked');
      expect(prisma._modules.find((m) => m.name === 'B').status).toBe('pending');
      expect(prisma._journal.some((e) => e.phase === 'blocked' && e.summary.includes('generate'))).toBe(true);
    });

    it('测试门未通过 → 模块 blocked', async () => {
      const runner = { generate: async () => ({ ok: true }), test: async () => ({ passed: false, detail: '场景未过' }) };
      const s = svc(runner);
      await s.plan(PID, [{ name: 'A' }]);
      await s.run(PID);
      expect(prisma._modules[0].status).toBe('blocked');
      expect(prisma._journal.some((e) => e.phase === 'blocked' && e.summary.includes('test'))).toBe(true);
    });
  });

  describe('续跑（跨会话/被打断后对账）', () => {
    it('卡在 building/testing 的模块在 run 时被重置为 pending 并重做完成', async () => {
      const s = svc(okRunner);
      await s.plan(PID, [{ name: 'A' }]);
      // 模拟上次被杀：A 卡在 building
      prisma._modules[0].status = 'building';

      const res = await s.run(PID);
      expect(res).toMatchObject({ done: 1, blocked: 0, total: 1 });
      expect(prisma._modules[0].status).toBe('done');
      // 有一条 resume 对账日志
      expect(prisma._journal.some((e) => e.phase === 'resume')).toBe(true);
    });
  });
});
