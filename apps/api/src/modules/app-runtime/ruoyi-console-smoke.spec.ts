import { smokeRuoyiConsole } from './ruoyi-console-smoke';

describe('smokeRuoyiConsole（控制台代理冒烟·交付门与守护探活共用）', () => {
  const cfg: any = {
    enabled: true,
    client: { baseUrl: 'http://r', clientId: 'cid', username: 'admin', password: 'admin123', tenantId: '000000' },
    mysql: {}, deploy: {},
  };
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  it('代理 login + list 200 → ok，走 consoleUrl+apiPrefix（非 API 直连）', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string) => {
      calls.push(url);
      if (url.includes('/auth/login')) return Promise.resolve({ status: 200, json: () => Promise.resolve({ code: 200, data: { access_token: 't' } }) });
      return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
    }) as any;
    const r = await smokeRuoyiConsole('http://console:8089/', { resources: ['equipment'], initialUsers: [{ userName: 'u1', password: 'p' }] }, { cfg });
    expect(r.ok).toBe(true);
    expect(calls[0]).toBe('http://console:8089/prod-api/auth/login');
    expect(calls[1]).toContain('/prod-api/system/equipment/list');
  });

  it('登录 code!=200（首页 200 但登不上）→ ok:false', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({ code: 401 }) }) as any;
    const r = await smokeRuoyiConsole('http://c', { resources: ['x'] }, { cfg });
    expect(r.ok).toBe(false);
  });

  it('list 非 200（控制台→后端断链）→ ok:false', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url.includes('login')
        ? Promise.resolve({ status: 200, json: () => Promise.resolve({ code: 200, data: { access_token: 't' } }) })
        : Promise.resolve({ status: 500, json: () => Promise.resolve({}) }),
    ) as any;
    const r = await smokeRuoyiConsole('http://c', { resources: ['x'] }, { cfg });
    expect(r.ok).toBe(false);
  });

  it('无业务资源 → 登录通即 ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({ code: 200, data: { access_token: 't' } }) }) as any;
    const r = await smokeRuoyiConsole('http://c', { resources: [] }, { cfg });
    expect(r.ok).toBe(true);
  });

  it('初始用户优先于 admin 冒烟', async () => {
    let body: any;
    global.fetch = jest.fn().mockImplementation((_u: string, opt: any) => {
      if (!body) body = JSON.parse(opt.body);
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ code: 200, data: { access_token: 't' } }) });
    }) as any;
    await smokeRuoyiConsole('http://c', { resources: [], initialUsers: [{ userName: 'u1', password: 'pw1' }] }, { cfg });
    expect(body.username).toBe('u1');
    expect(body.password).toBe('pw1');
  });
});
