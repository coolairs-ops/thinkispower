import { RuoyiClient, RuoyiClientConfig } from './ruoyi-client.service';

describe('RuoyiClient（若依 codegen REST 客户端 · M3b）', () => {
  const cfg: RuoyiClientConfig = {
    baseUrl: 'http://ruoyi.test',
    clientId: 'cid',
    username: 'admin',
    password: 'admin123',
    tenantId: '000000',
  };
  let client: RuoyiClient;

  beforeEach(() => {
    client = new RuoyiClient();
  });

  it('generate 编排：login→importTable→list→preview，返回产码文件集', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string, opts: any) => {
      calls.push(`${opts.method} ${url}`);
      if (url.endsWith('/auth/login')) return jsonRes({ code: 200, data: { access_token: 'tok-123' } });
      if (url.includes('/tool/gen/importTable')) return jsonRes({ code: 200 });
      if (url.includes('/tool/gen/list')) return jsonRes({ rows: [{ tableId: 42, tableName: 'demo_store' }] });
      if (url.includes('/tool/gen/preview/42')) return jsonRes({ code: 200, data: { 'controller.java.vm': 'class X{}', 'index.vue.vm': '<template/>' } });
      throw new Error('unexpected ' + url);
    }) as any;

    const files = await client.generate(cfg, 'demo_store');
    expect(Object.keys(files)).toEqual(['controller.java.vm', 'index.vue.vm']);
    // 顺序正确
    expect(calls[0]).toContain('/auth/login');
    expect(calls[1]).toContain('/tool/gen/importTable?tables=demo_store');
    expect(calls[2]).toContain('/tool/gen/list?tableName=demo_store');
    expect(calls[3]).toContain('/tool/gen/preview/42');
  });

  it('login 带 clientId/grantType；后续请求带 Bearer+clientid 头', async () => {
    let loginBody: any;
    let previewHeaders: any;
    global.fetch = jest.fn(async (url: string, opts: any) => {
      if (url.endsWith('/auth/login')) { loginBody = JSON.parse(opts.body); return jsonRes({ data: { access_token: 'tok' } }); }
      if (url.includes('importTable')) return jsonRes({ code: 200 });
      if (url.includes('list')) return jsonRes({ rows: [{ tableId: 7, tableName: 'demo_store' }] });
      if (url.includes('preview')) { previewHeaders = opts.headers; return jsonRes({ data: { f: 'x' } }); }
      throw new Error('x');
    }) as any;

    await client.generate(cfg, 'demo_store');
    expect(loginBody).toMatchObject({ clientId: 'cid', grantType: 'password', tenantId: '000000' });
    expect(previewHeaders.Authorization).toBe('Bearer tok');
    expect(previewHeaders.clientid).toBe('cid');
  });

  it('登录无 token → 抛错', async () => {
    global.fetch = jest.fn(async () => jsonRes({ code: 500, msg: 'bad' })) as any;
    await expect(client.login(cfg)).rejects.toThrow('登录失败');
  });

  // 真·实例集成测试：仅当 RUOYI_BASE_URL 设置时运行（对正在跑的 RuoYi-Vue-Plus）。
  const live = process.env.RUOYI_BASE_URL ? it : it.skip;
  live('LIVE：对真若依跑通 generate(demo_store)，产出含 controller', async () => {
    const realCfg: RuoyiClientConfig = {
      baseUrl: process.env.RUOYI_BASE_URL!,
      clientId: process.env.RUOYI_CLIENT_ID || 'e5cd7e4891bf95d1d19206ce24a7b32e',
      username: process.env.RUOYI_USER || 'admin',
      password: process.env.RUOYI_PASS || 'admin123',
      tenantId: process.env.RUOYI_TENANT || '000000',
    };
    const files = await new RuoyiClient().generate(realCfg, 'demo_store');
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(files).some((k) => /controller/i.test(k))).toBe(true);
  }, 30000);
});

function jsonRes(obj: unknown) {
  return { json: async () => obj } as any;
}
