import { BadRequestException } from '@nestjs/common';
import { AppRuntimeController } from './app-runtime.controller';

/** prisma.project.findUnique 返回指定 backendRuntime。 */
function make(backendRuntime: unknown, proxyEnabled = true) {
  const prisma = { project: { findUnique: jest.fn(async () => ({ backendRuntime })) } };
  const crud = { list: jest.fn(async () => ({ data: ['B'], total: 1 })), get: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const proxy = {
    get enabled() { return proxyEnabled; },
    login: jest.fn(async () => ({ session: 's1', user: 'zhang', expiresInMs: 1 })),
    logout: jest.fn(),
    list: jest.fn(async () => ({ data: ['RUOYI'], total: 9, page: 1, pageSize: 10 })),
    get: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn(),
  };
  const ctrl = new AppRuntimeController(prisma as never, crud as never, proxy as never, {} as never, {} as never, {} as never);
  return { ctrl, prisma, crud, proxy };
}

describe('AppRuntimeController · /api/app 按 backendRuntime 分流', () => {
  it('若依 ready → list 走代理（带 session），不走路B', async () => {
    const { ctrl, crud, proxy } = make({ kind: 'ruoyi', status: 'ready' });
    const res = await ctrl.list('p1', 'customer', { page: '1' }, 'sess-abc');
    expect(proxy.list).toHaveBeenCalledWith('customer', 'sess-abc', expect.objectContaining({ page: 1 }));
    expect(crud.list).not.toHaveBeenCalled();
    expect(res).toMatchObject({ data: ['RUOYI'] });
  });

  it('非若依（路B）→ list 走 CrudDataService', async () => {
    const { ctrl, crud, proxy } = make(null);
    const res = await ctrl.list('p1', 'todo', {}, undefined);
    expect(crud.list).toHaveBeenCalled();
    expect(proxy.list).not.toHaveBeenCalled();
    expect(res).toMatchObject({ data: ['B'] });
  });

  it('若依置备中（status≠ready）→ 仍走路B（不显示尚不存在的数据）', async () => {
    const { ctrl, crud, proxy } = make({ kind: 'ruoyi', status: 'provisioning' });
    await ctrl.list('p1', 'customer', {}, undefined);
    expect(crud.list).toHaveBeenCalled();
    expect(proxy.list).not.toHaveBeenCalled();
  });

  it('未配若依实例（proxy.enabled=false）→ 不打 DB、直接走路B', async () => {
    const { ctrl, prisma, crud } = make({ kind: 'ruoyi', status: 'ready' }, false);
    await ctrl.list('p1', 'customer', {}, undefined);
    expect(prisma.project.findUnique).not.toHaveBeenCalled(); // 快速否决，省一次查询
    expect(crud.list).toHaveBeenCalled();
  });

  it('_login：若依后端 → 调代理登录；非若依 → 400', async () => {
    const ruoyi = make({ kind: 'ruoyi', status: 'ready' });
    await expect(ruoyi.ctrl.login('p1', { username: 'zhang', password: 'pw' })).resolves.toMatchObject({ session: 's1' });

    const pathB = make(null);
    await expect(pathB.ctrl.login('p1', { username: 'a', password: 'b' })).rejects.toThrow(BadRequestException);
  });

  it('_login：固定测试账号 ceshi/ceshi123 → 映射为当前项目专属账号', async () => {
    const ruoyi = make({
      kind: 'ruoyi',
      status: 'ready',
      initialUsers: [{ userName: 'proj_u1', password: 'real-pwd' }],
    });

    await ruoyi.ctrl.login('p1', { username: 'ceshi', password: 'ceshi123' });

    expect(ruoyi.proxy.login).toHaveBeenCalledWith('proj_u1', 'real-pwd');
  });
});
