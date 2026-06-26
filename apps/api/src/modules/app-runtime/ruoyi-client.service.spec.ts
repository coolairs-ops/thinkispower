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

  it('importAndDownload：importTable 前先删同名旧 gen_table 行（去重 dup）再下载', async () => {
    const calls: string[] = [];
    let listCount = 0;
    global.fetch = jest.fn(async (url: string, opts: any) => {
      calls.push(`${opts.method} ${url}`);
      if (url.endsWith('/auth/login')) return jsonRes({ data: { access_token: 't' } });
      if (url.includes('/tool/gen/list')) {
        listCount++;
        // 首次(dedup 扫描)返回两条同名 dup；之后(findTableId)返回干净一条
        return listCount === 1
          ? jsonRes({ rows: [{ tableId: 11, tableName: 'store' }, { tableId: 12, tableName: 'store' }] })
          : jsonRes({ rows: [{ tableId: 13, tableName: 'store' }] });
      }
      if (url.match(/\/tool\/gen\/[\d,]+$/) && opts.method === 'DELETE') return jsonRes({ code: 200 });
      if (url.includes('/tool/gen/importTable')) return jsonRes({ code: 200 });
      if (url.includes('/tool/gen/download/13')) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      throw new Error('unexpected ' + opts.method + ' ' + url);
    }) as any;

    const buf = await client.importAndDownload(cfg, 'store');
    expect(Buffer.isBuffer(buf) && buf.length).toBe(3);
    // DELETE 删了 11,12，且发生在 importTable 之前
    const delIdx = calls.findIndex((c) => c.startsWith('DELETE') && c.includes('/tool/gen/11,12'));
    const importIdx = calls.findIndex((c) => c.includes('importTable'));
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeGreaterThan(delIdx);
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

  describe('seedRoles（RBAC 运行时配 · data_scope）', () => {
    it('幂等：已存在 roleKey 跳过，只建缺的；createRole 带正确 dataScope', async () => {
      const posted: any[] = [];
      global.fetch = jest.fn(async (url: string, opts: any) => {
        if (url.endsWith('/auth/login')) return jsonRes({ code: 200, data: { access_token: 'tok' } });
        if (url.includes('/system/role/list')) return jsonRes({ rows: [{ roleKey: 'app_admin' }] }); // admin 已存在
        if (url.endsWith('/system/role') && opts.method === 'POST') { posted.push(JSON.parse(opts.body)); return jsonRes({ code: 200 }); }
        throw new Error('unexpected ' + url);
      }) as any;

      const r = await client.seedRoles(cfg, [
        { roleName: '管理员', roleKey: 'app_admin', dataScope: '1' }, // 已存在→跳过
        { roleName: '普通用户', roleKey: 'app_user', dataScope: '5' }, // 新建
      ]);
      expect(r).toEqual({ created: 1, skipped: 1 });
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ roleKey: 'app_user', dataScope: '5', status: '0' });
    });

    it('createRole 返回非 200 → 抛错', async () => {
      global.fetch = jest.fn(async (url: string, opts: any) => {
        if (url.endsWith('/auth/login')) return jsonRes({ data: { access_token: 't' } });
        if (url.includes('/system/role/list')) return jsonRes({ rows: [] });
        if (url.endsWith('/system/role')) return jsonRes({ code: 500, msg: '权限不足' });
        throw new Error('x');
      }) as any;
      await expect(client.seedRoles(cfg, [{ roleName: '普通', roleKey: 'u', dataScope: '5' }])).rejects.toThrow('createRole 失败');
    });
  });

  describe('seedUsers（终端用户 sys_user + 绑角色 · P2）', () => {
    it('幂等：已存在 userName 跳过；按 roleKey 解析 roleId 绑角色，含 deptId/status', async () => {
      const posted: any[] = [];
      global.fetch = jest.fn(async (url: string, opts: any) => {
        if (url.endsWith('/auth/login')) return jsonRes({ code: 200, data: { access_token: 'tok' } });
        if (url.includes('/system/role/list')) return jsonRes({ rows: [{ roleId: 1001, roleKey: 'app_role_1' }, { roleId: '2068', roleKey: 'app_role_2' }] });
        if (url.includes('/system/user/list')) return jsonRes({ rows: [{ userName: 'lijingli' }] }); // 李经理已存在
        if (url.endsWith('/system/user') && opts.method === 'POST') { posted.push(JSON.parse(opts.body)); return jsonRes({ code: 200 }); }
        throw new Error('unexpected ' + url);
      }) as any;

      const r = await client.seedUsers(cfg, [
        { userName: 'lijingli', password: 'x', roleKey: 'app_role_1' }, // 已存在→跳过
        { userName: 'zhangsan', password: 'Zhang@123', roleKey: 'app_role_2' }, // 新建（仅本人）
      ]);
      expect(r).toEqual({ created: 1, skipped: 1 });
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ userName: 'zhangsan', roleIds: ['2068'], deptId: 100, status: '0' });
    });

    it('roleKey 不存在 → 抛错（不静默建无权限用户）', async () => {
      global.fetch = jest.fn(async (url: string) => {
        if (url.endsWith('/auth/login')) return jsonRes({ data: { access_token: 't' } });
        if (url.includes('/system/role/list')) return jsonRes({ rows: [] });
        if (url.includes('/system/user/list')) return jsonRes({ rows: [] });
        throw new Error('x');
      }) as any;
      await expect(client.seedUsers(cfg, [{ userName: 'u', password: 'p', roleKey: 'nope' }])).rejects.toThrow('角色不存在');
    });

    it('createUser 返回非 200 → 抛错', async () => {
      global.fetch = jest.fn(async (url: string, opts: any) => {
        if (url.endsWith('/auth/login')) return jsonRes({ data: { access_token: 't' } });
        if (url.includes('/system/role/list')) return jsonRes({ rows: [{ roleId: 1, roleKey: 'r' }] });
        if (url.includes('/system/user/list')) return jsonRes({ rows: [] });
        if (url.endsWith('/system/user') && opts.method === 'POST') return jsonRes({ code: 500, msg: '密码不合规' });
        throw new Error('x');
      }) as any;
      await expect(client.seedUsers(cfg, [{ userName: 'u', password: 'p', roleKey: 'r' }])).rejects.toThrow('createUser 失败');
    });
  });

  describe('seedMenusAndGrant（接口权限点 + 绑角色 · 坎1）', () => {
    it('建业务目录 + C页菜单(承载list) + F权限点(挂C下) 并绑角色(并集保留原有)', async () => {
      // 有状态 mock：菜单累积，/system/menu/list 返回当前全部
      const menus: Array<{ menuId: number; perms?: string; menuName?: string; menuType?: string }> = [];
      const createdPerms: string[] = [];
      let dirCreated = false;
      let nextId = 90000;
      let putBody: any;
      global.fetch = jest.fn(async (url: string, opts: any) => {
        if (url.endsWith('/auth/login')) return jsonRes({ code: 200, data: { access_token: 'tok' } });
        if (url.includes('/tool/gen/list')) return jsonRes({ rows: [{ tableId: 1, tableName: 'customer', moduleName: 'system', businessName: 'customer', functionName: '客户' }] });
        if (url.includes('/system/menu/list')) return jsonRes({ data: menus.map((m) => ({ ...m })) });
        if (url.endsWith('/system/menu') && opts.method === 'POST') {
          const b = JSON.parse(opts.body);
          menus.push({ menuId: ++nextId, perms: b.perms, menuName: b.menuName, menuType: b.menuType });
          if (b.menuType === 'M') dirCreated = true;
          else if (b.perms) createdPerms.push(b.perms);
          return jsonRes({ code: 200 });
        }
        if (url.includes('/system/role/list')) return jsonRes({ rows: [{ roleId: '2068', roleKey: 'app_role_2' }] });
        if (url.includes('/system/menu/roleMenuTreeselect/2068')) return jsonRes({ data: { checkedKeys: [777] } }); // 角色原有菜单 777
        if (url.match(/\/system\/role\/2068$/) && opts.method === 'GET') return jsonRes({ code: 200, data: { roleId: '2068', roleKey: 'app_role_2', roleName: '普通', dataScope: '5', status: '0' } });
        if (url.endsWith('/system/role') && opts.method === 'PUT') { putBody = JSON.parse(opts.body); return jsonRes({ code: 200 }); }
        throw new Error('unexpected ' + opts.method + ' ' + url);
      }) as any;

      const r = await client.seedMenusAndGrant(cfg, ['customer'], ['app_role_2']);
      expect(dirCreated).toBe(true); // 建了业务目录(menu_type=M)
      // C 页菜单承载 list；F 五项 query/add/edit/remove/export
      expect(createdPerms.sort()).toEqual([
        'system:customer:add', 'system:customer:edit', 'system:customer:export',
        'system:customer:list', 'system:customer:query', 'system:customer:remove',
      ]);
      expect(r.menusCreated).toBe(6); // 1 C + 5 F
      expect(r.rolesGranted).toBe(1);
      expect(putBody.dataScope).toBe('5'); // dataScope 不动
      expect(putBody.menuIds).toContain(777); // 原有菜单保留(并集)
      expect(putBody.menuIds.length).toBeGreaterThanOrEqual(7); // 777 + 目录 + C + 5F
    });

    it('无资源或无角色 → 直接返回零，不登录', async () => {
      global.fetch = jest.fn(async () => { throw new Error('should not fetch'); }) as any;
      expect(await client.seedMenusAndGrant(cfg, [], ['r'])).toEqual({ menusCreated: 0, rolesGranted: 0 });
      expect(await client.seedMenusAndGrant(cfg, ['x'], [])).toEqual({ menusCreated: 0, rolesGranted: 0 });
    });
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

  live('LIVE：对真若依 seedRoles 建"仅本人/全部"数据权限角色（幂等）', async () => {
    const realCfg: RuoyiClientConfig = {
      baseUrl: process.env.RUOYI_BASE_URL!,
      clientId: process.env.RUOYI_CLIENT_ID || 'e5cd7e4891bf95d1d19206ce24a7b32e',
      username: process.env.RUOYI_USER || 'admin',
      password: process.env.RUOYI_PASS || 'admin123',
      tenantId: process.env.RUOYI_TENANT || '000000',
    };
    const r = await new RuoyiClient().seedRoles(realCfg, [
      { roleName: '门店店员', roleKey: 'tip_store_clerk', dataScope: '5' }, // 仅本人
      { roleName: '门店管理员', roleKey: 'tip_store_admin', dataScope: '1' }, // 全部
    ]);
    expect(r.created + r.skipped).toBe(2); // 首次建 2 / 重跑跳 2
  }, 30000);

  live('LIVE：seedUsers 建张三(仅本人 app_role_2)/李经理(全部 app_role_1)，幂等', async () => {
    const realCfg: RuoyiClientConfig = {
      baseUrl: process.env.RUOYI_BASE_URL!,
      clientId: process.env.RUOYI_CLIENT_ID || 'e5cd7e4891bf95d1d19206ce24a7b32e',
      username: process.env.RUOYI_USER || 'admin',
      password: process.env.RUOYI_PASS || 'admin123',
      tenantId: process.env.RUOYI_TENANT || '000000',
    };
    const r = await new RuoyiClient().seedUsers(realCfg, [
      { userName: 'zhangsan', nickName: '张三', password: 'Zhang@123', roleKey: 'app_role_2' }, // dataScope 5 仅本人
      { userName: 'lijingli', nickName: '李经理', password: 'Li@123456', roleKey: 'app_role_1' }, // dataScope 1 全部
    ]);
    expect(r.created + r.skipped).toBe(2); // 首次建 2 / 重跑跳 2
  }, 60000);

  live('LIVE：seedMenusAndGrant 给客户系统 4 资源种权限点并绑 app_role_1/2（解 403）', async () => {
    const realCfg: RuoyiClientConfig = {
      baseUrl: process.env.RUOYI_BASE_URL!,
      clientId: process.env.RUOYI_CLIENT_ID || 'e5cd7e4891bf95d1d19206ce24a7b32e',
      username: process.env.RUOYI_USER || 'admin',
      password: process.env.RUOYI_PASS || 'admin123',
      tenantId: process.env.RUOYI_TENANT || '000000',
    };
    const r = await new RuoyiClient().seedMenusAndGrant(
      realCfg,
      ['customer', 'project', 'task', 'dashboardstats'],
      ['app_role_1', 'app_role_2'],
    );
    expect(r.rolesGranted).toBe(2); // 两个业务角色都绑上
  }, 60000);
});

function jsonRes(obj: unknown) {
  return { json: async () => obj } as any;
}
