import { UnauthorizedException } from '@nestjs/common';
import { RuoyiDataProxyService } from './ruoyi-data-proxy.service';

/** 用 env 打开实例（enabled + cfg.client），构造时读 process.env。 */
function make(client: Record<string, unknown>) {
  const orig = process.env;
  process.env = { ...orig, RUOYI_BASE_URL: 'http://127.0.0.1:8080', RUOYI_SRC_ROOT: 'D:/ruoyi-study', RUOYI_CLIENT_ID: 'cid-1' } as NodeJS.ProcessEnv;
  const svc = new RuoyiDataProxyService(client as never);
  process.env = orig;
  return svc;
}

describe('RuoyiDataProxyService（A 架构·按本人 token 代持转发）', () => {
  afterEach(() => jest.useRealTimers());

  it('login 用本人账密换 token、回 session；list 用**本人 token** 调若依并映射回路B契约', async () => {
    const client = {
      login: jest.fn(async (cfg: any) => `tok-${cfg.username}`),
      dataList: jest.fn(async () => ({ rows: [{ id: 7, name: '张三的客户' }], total: 1 })),
    };
    const svc = make(client);
    expect(svc.enabled).toBe(true);

    const { session, user } = await svc.login('zhangsan', 'pw');
    expect(user).toBe('zhangsan');
    // login 走本人账密（不是 admin 默认）
    expect(client.login).toHaveBeenCalledWith(expect.objectContaining({ username: 'zhangsan', password: 'pw', clientId: 'cid-1' }));

    const res = await svc.list('customer', session, { page: 1, pageSize: 10 });
    // 关键：调若依带的是**张三本人**的 token（data_scope 据此生效），不是共享 admin
    expect(client.dataList).toHaveBeenCalledWith(expect.anything(), 'tok-zhangsan', 'customer', { page: 1, pageSize: 10 });
    // 若依 {rows,total} → 路B {data,total}
    expect(res).toEqual({ data: [{ id: 7, name: '张三的客户' }], total: 1, page: 1, pageSize: 10 });
  });

  it('无 session → 401（强制以本人身份调，不退 admin）', async () => {
    const svc = make({ login: jest.fn(), dataList: jest.fn() });
    await expect(svc.list('customer', undefined, {})).rejects.toThrow(UnauthorizedException);
  });

  it('未知/已登出 session → 401', async () => {
    const svc = make({ dataList: jest.fn() });
    await expect(svc.list('customer', 'no-such-session', {})).rejects.toThrow(UnauthorizedException);
  });

  it('session 过期（>30min）→ 401', async () => {
    jest.useFakeTimers();
    const client = { login: jest.fn(async () => 'tok'), dataList: jest.fn(async () => ({ rows: [], total: 0 })) };
    const svc = make(client);
    const { session } = await svc.login('u', 'p');
    await expect(svc.list('x', session, {})).resolves.toBeDefined(); // 刚登录可用
    await jest.advanceTimersByTimeAsync(31 * 60 * 1000);
    await expect(svc.list('x', session, {})).rejects.toThrow('过期');
  });

  it('logout 后 session 作废', async () => {
    const svc = make({ login: jest.fn(async () => 'tok'), dataList: jest.fn(async () => ({ rows: [], total: 0 })) });
    const { session } = await svc.login('u', 'p');
    svc.logout(session);
    await expect(svc.list('x', session, {})).rejects.toThrow(UnauthorizedException);
  });

  it('update 把 id 并进 body 交给若依 PUT；create/remove 映射正确', async () => {
    const client = {
      login: jest.fn(async () => 'tok'),
      dataCreate: jest.fn(async () => ({ id: 9 })),
      dataUpdate: jest.fn(async () => undefined),
      dataRemove: jest.fn(async () => undefined),
    };
    const svc = make(client);
    const { session } = await svc.login('u', 'p');

    expect(await svc.create('customer', session, { name: 'A' })).toEqual({ data: { id: 9 } });
    expect(client.dataCreate).toHaveBeenCalledWith(expect.anything(), 'tok', 'customer', { name: 'A' });

    expect(await svc.update('customer', session, '5', { name: 'B' })).toEqual({ data: true });
    expect(client.dataUpdate).toHaveBeenCalledWith(expect.anything(), 'tok', 'customer', { name: 'B', id: '5' });

    expect(await svc.remove('customer', session, '5')).toEqual({});
    expect(client.dataRemove).toHaveBeenCalledWith(expect.anything(), 'tok', 'customer', '5');
  });
});
