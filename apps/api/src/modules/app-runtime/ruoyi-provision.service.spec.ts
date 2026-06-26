import { BadRequestException } from '@nestjs/common';
import { RuoyiProvisionService } from './ruoyi-provision.service';
import { AppSpec } from './app-spec.types';

const spec: AppSpec = { entities: [{ name: 'X', table: 'x', fields: [{ name: 'id', prismaType: 'BigInt', optional: false, isId: true, isUnique: false }] }], roles: [], menus: [] };

describe('RuoyiProvisionService', () => {
  const baseEnv = { RUOYI_BASE_URL: 'http://127.0.0.1:8080', RUOYI_SRC_ROOT: 'D:/ruoyi-study' };

  function make(env: Record<string, string | undefined>, backendRuntime: unknown = null) {
    const prisma = {
      project: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ userId: 'u1', backendRuntime }),
      },
    };
    const client = {};
    const runtime = { provisionApp: jest.fn().mockResolvedValue({ descriptor: { kind: 'ruoyi', resources: ['x'], status: 'ready' } }) };
    const assembler = { fromProject: jest.fn().mockResolvedValue(spec) };
    const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const orig = process.env;
    process.env = { ...orig, ...env } as NodeJS.ProcessEnv;
    const svc = new RuoyiProvisionService(prisma as never, client as never, runtime as never, assembler as never, queue as never);
    process.env = orig;
    return { svc, prisma, runtime, assembler, queue };
  }

  it('已配实例：调 provisionApp 并持久 descriptor 到 project.backendRuntime', async () => {
    const { svc, prisma, runtime } = make(baseEnv);
    expect(svc.enabled).toBe(true);
    const res = await svc.provision('p1', spec);
    expect(runtime.provisionApp).toHaveBeenCalledWith('p1', spec, expect.objectContaining({ baseUrl: 'http://127.0.0.1:8080' }), expect.anything(), expect.anything(), expect.anything(), expect.anything());
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { backendRuntime: res.descriptor } });
  });

  it('未配实例（缺 BASE_URL/SRC_ROOT）→ enabled=false，provision 拒绝', async () => {
    const { svc, runtime } = make({ RUOYI_BASE_URL: undefined, RUOYI_SRC_ROOT: undefined });
    expect(svc.enabled).toBe(false);
    await expect(svc.provision('p1', spec)).rejects.toThrow(BadRequestException);
    expect(runtime.provisionApp).not.toHaveBeenCalled();
  });

  describe('ensureProvisioned（ADR-0005：交付/迭代自动触发置备）', () => {
    it('路B 项目(非 ruoyi) → 不触发(no-op)', async () => {
      const { svc, queue } = make(baseEnv, { kind: 'crud', status: 'ready' });
      const r = await svc.ensureProvisioned('p1');
      expect(r).toMatchObject({ triggered: false, status: 'not-ruoyi' });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('若依已就绪 → 不重复触发', async () => {
      const { svc, queue } = make(baseEnv, { kind: 'ruoyi', status: 'ready' });
      expect((await svc.ensureProvisioned('p1')).status).toBe('ready');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('若依置备中 → 不重复触发', async () => {
      const { svc, queue } = make(baseEnv, { kind: 'ruoyi', status: 'provisioning' });
      expect((await svc.ensureProvisioned('p1')).status).toBe('provisioning');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('若依置备失败/未就绪 → 装配 spec + 标 provisioning + 入队（保留断点相位）', async () => {
      const { svc, prisma, queue, assembler } = make(baseEnv, { kind: 'ruoyi', status: 'error', phase: 'deployed' });
      const r = await svc.ensureProvisioned('p1', { userId: 'u1' });
      expect(r).toMatchObject({ triggered: true, status: 'provisioning', jobId: 'job-1' });
      expect(assembler.fromProject).toHaveBeenCalledWith('u1', 'p1');
      expect(queue.add).toHaveBeenCalled();
      // 续跑相位保留
      const upd = prisma.project.update.mock.calls[0][0].data.backendRuntime;
      expect(upd).toMatchObject({ kind: 'ruoyi', status: 'provisioning', phase: 'deployed' });
    });

    it('已指定若依但未置备(status=pending) → 交付时自动触发置备', async () => {
      const { svc, queue } = make(baseEnv, { kind: 'ruoyi', status: 'pending' });
      const r = await svc.ensureProvisioned('p1', { userId: 'u1' });
      expect(r.triggered).toBe(true);
      expect(queue.add).toHaveBeenCalled();
    });

    it('force（显式 opt-in）→ 即便非 ruoyi 也触发', async () => {
      const { svc, queue } = make(baseEnv, null);
      const r = await svc.ensureProvisioned('p1', { userId: 'u1', force: true });
      expect(r.triggered).toBe(true);
      expect(queue.add).toHaveBeenCalled();
    });

    it('未配实例 → disabled，不触发', async () => {
      const { svc, queue } = make({ RUOYI_BASE_URL: undefined, RUOYI_SRC_ROOT: undefined }, { kind: 'ruoyi', status: 'error' });
      expect((await svc.ensureProvisioned('p1')).status).toBe('disabled');
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('designate（方案页若依开关·第2层显式意图）', () => {
    it('路B 项目 use=true → 标 backendRuntime={kind:ruoyi,status:pending}', async () => {
      const { svc, prisma } = make(baseEnv, null);
      const r = await svc.designate('p1', true);
      expect(r).toEqual({ desiredBackend: 'ruoyi', status: 'pending' });
      expect(prisma.project.update.mock.calls[0][0].data.backendRuntime).toMatchObject({ kind: 'ruoyi', status: 'pending' });
    });

    it('已是若依(ready) use=true → 幂等不动', async () => {
      const { svc, prisma } = make(baseEnv, { kind: 'ruoyi', status: 'ready' });
      expect((await svc.designate('p1', true)).status).toBe('ready');
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('pending use=false → 清回路B(null)', async () => {
      const { svc, prisma } = make(baseEnv, { kind: 'ruoyi', status: 'pending' });
      expect(await svc.designate('p1', false)).toEqual({ desiredBackend: 'crud' });
      expect(prisma.project.update.mock.calls[0][0].data.backendRuntime).toBeNull();
    });

    it('已置备(ready) use=false → 不静默抹除', async () => {
      const { svc, prisma } = make(baseEnv, { kind: 'ruoyi', status: 'ready' });
      expect((await svc.designate('p1', false)).desiredBackend).toBe('ruoyi');
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });
});
