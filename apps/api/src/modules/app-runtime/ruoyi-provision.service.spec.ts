import { BadRequestException } from '@nestjs/common';
import { RuoyiProvisionService } from './ruoyi-provision.service';
import { AppSpec } from './app-spec.types';

const spec: AppSpec = { entities: [{ name: 'X', table: 'x', fields: [{ name: 'id', prismaType: 'BigInt', optional: false, isId: true, isUnique: false }] }], roles: [], menus: [] };

describe('RuoyiProvisionService', () => {
  const baseEnv = { RUOYI_BASE_URL: 'http://127.0.0.1:8080', RUOYI_SRC_ROOT: 'D:/ruoyi-study' };

  function make(env: Record<string, string | undefined>) {
    const prisma = { project: { update: jest.fn().mockResolvedValue({}) } };
    const client = {};
    const runtime = { provisionApp: jest.fn().mockResolvedValue({ descriptor: { kind: 'ruoyi', resources: ['x'], status: 'ready' } }) };
    const orig = process.env;
    process.env = { ...orig, ...env } as NodeJS.ProcessEnv;
    const svc = new RuoyiProvisionService(prisma as never, client as never, runtime as never);
    process.env = orig;
    return { svc, prisma, runtime };
  }

  it('已配实例：调 provisionApp 并持久 descriptor 到 project.backendRuntime', async () => {
    const { svc, prisma, runtime } = make(baseEnv);
    expect(svc.enabled).toBe(true);
    const res = await svc.provision('p1', spec);
    expect(runtime.provisionApp).toHaveBeenCalledWith('p1', spec, expect.objectContaining({ baseUrl: 'http://127.0.0.1:8080' }), expect.anything());
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { backendRuntime: res.descriptor } });
  });

  it('未配实例（缺 BASE_URL/SRC_ROOT）→ enabled=false，provision 拒绝', async () => {
    const { svc, runtime } = make({ RUOYI_BASE_URL: undefined, RUOYI_SRC_ROOT: undefined });
    expect(svc.enabled).toBe(false);
    await expect(svc.provision('p1', spec)).rejects.toThrow(BadRequestException);
    expect(runtime.provisionApp).not.toHaveBeenCalled();
  });
});
