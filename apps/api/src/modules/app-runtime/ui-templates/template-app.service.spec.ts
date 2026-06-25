import { BadRequestException } from '@nestjs/common';
import { TemplateAppService } from './template-app.service';

const F = (name: string, isId = false) => ({ name, prismaType: 'String', optional: false, isId, isUnique: false });
const entities = [{ name: '企业', table: 'company', fields: [F('id', true), F('name'), F('level'), F('score'), F('status'), F('createdAt')] }];

function build(dataModel: string | null, planSummary: any = null) {
  const store: any = {};
  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue({ name: '企业风险监管平台', dataModel, themeConfig: {}, planSummary }),
      update: jest.fn().mockImplementation(({ data }: any) => { Object.assign(store, data); return Promise.resolve({}); }),
    },
  };
  const schema = { parseAndValidate: jest.fn().mockReturnValue(dataModel ? entities : []) };
  return { svc: new TemplateAppService(prisma as any, schema as any), prisma, store };
}

describe('TemplateAppService（模板出页接进 serve 链）', () => {
  it('数据模型 → 套模板 → 存 demoHtml（确定性、含主题/资源/appData，不调 LLM）', async () => {
    const { svc, prisma, store } = build('model Company { id String @id }');
    const r = await svc.buildAndStore('p1', 'gov-blue');
    expect(r).toMatchObject({ theme: 'gov-blue', resource: 'company' });
    expect(prisma.project.update).toHaveBeenCalled();
    expect(store.status).toBe('demo_ready');
    expect(store.demoHtml).toContain('--t-header-bg:#185FA5'); // 政务蓝主题
    expect(store.demoHtml).toContain('/api/app/p1/'); // appData 注入
    expect(store.demoHtml).toContain('"primaryResource":"company"'); // 主资源填槽
    expect(store.themeConfig.templateTheme).toBe('gov-blue'); // 主题持久化
  });

  it('换主题 → 换皮（同结构不同色）', async () => {
    const { svc, store } = build('model Company { id String @id }');
    await svc.buildAndStore('p1', 'dark-ops');
    expect(store.demoHtml).toContain('--t-header-bg:#021d38'); // 深色大屏
  });

  it('分级类字段自动标徽章列', async () => {
    const { svc, store } = build('model Company { id String @id }');
    await svc.buildAndStore('p1');
    expect(store.demoHtml).toContain('"badges":[false,true,false,false]'); // name/level/score/status → level 是徽章
  });

  it('无数据模型 → BadRequest（不静默出空壳）', async () => {
    const { svc } = build(null);
    await expect(svc.buildAndStore('p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('主资源跳过通用 user 实体，选第一个业务实体（修"所有 demo 都成用户表"）', async () => {
    const store: any = {};
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ name: '短剧剧本生成平台', dataModel: 'x', themeConfig: {} }),
        update: jest.fn().mockImplementation(({ data }: any) => { Object.assign(store, data); return Promise.resolve({}); }),
      },
    };
    const userFirst = [
      { name: '用户', table: 'user', fields: [F('id', true), F('email'), F('password'), F('name')] },
      { name: '剧本', table: 'scene', fields: [F('id', true), F('title'), F('genre')] },
    ];
    const schema = { parseAndValidate: jest.fn().mockReturnValue(userFirst) };
    const svc = new TemplateAppService(prisma as any, schema as any);
    const r = await svc.buildAndStore('p1', 'gov-blue');
    expect(r.resource).toBe('scene'); // 跳过 user → 业务实体
    expect(store.demoHtml).toContain('"primaryResource":"scene"');
    expect(store.demoHtml).not.toMatch(/"columns":\[[^\]]*"password"/); // 工作台 columns 不含 user 的 password 列（登录门 type="password" 不算）
  });

  it('planSummary 的签名功能(生成类)出功能段 + 导航项（方案C确定性底座，反映业务需求）', async () => {
    const ps = { features: ['登录 — 账号密码', '剧本生成 — 输入大纲生成含分镜剧本', '历史项目管理 — 查看复用'] };
    const { svc, store } = build('model Company { id String @id }', ps);
    await svc.buildAndStore('p1', 'gov-blue');
    expect(store.demoHtml).toContain('剧本生成'); // 签名功能段标题
    expect(store.demoHtml).toContain('一键生成'); // 生成页型组件
    expect(store.demoHtml).toContain('data-page="feat1"'); // 功能段 section
    // 登录(标准能力,登录门覆盖)/历史管理(列表覆盖) 不单出功能段
    expect(store.demoHtml).not.toContain('历史项目管理');
  });

  function buildWithAi(planSummary: any, deepseek: any) {
    const store: any = {};
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ name: '短剧剧本生成平台', dataModel: 'x', themeConfig: {}, planSummary }),
        update: jest.fn().mockImplementation(({ data }: any) => { Object.assign(store, data); return Promise.resolve({}); }),
      },
    };
    const schema = { parseAndValidate: jest.fn().mockReturnValue(entities) };
    return { svc: new TemplateAppService(prisma as any, schema as any, deepseek), store };
  }
  const psGen = { features: ['剧本生成 — 输入大纲生成含分镜剧本'] };

  it('C·AI 增强：DeepSeek 产物消毒后用作功能段内容（替代确定性页型）', async () => {
    const deepseek = { chat: jest.fn().mockResolvedValue('```html\n<div class="card">AI定制分镜表<table><th>镜号</th></table></div>\n```') };
    const { svc, store } = buildWithAi(psGen, deepseek);
    await svc.buildAndStore('p1', 'gov-blue');
    expect(deepseek.chat).toHaveBeenCalled();
    expect(store.demoHtml).toContain('AI定制分镜表'); // 用了 AI 产物
    expect(store.demoHtml).toContain('剧本生成'); // 段标题仍在
    expect(store.demoHtml).not.toContain('```'); // 代码围栏被消毒
  });

  it('C·AI 失败 → 回退确定性页型（永不空/不崩）', async () => {
    const deepseek = { chat: jest.fn().mockRejectedValue(new Error('timeout')) };
    const { svc, store } = buildWithAi(psGen, deepseek);
    await svc.buildAndStore('p1', 'gov-blue');
    expect(store.demoHtml).toContain('一键生成'); // 回退到确定性生成页型
  });

  it('C·AI 产物含 script/整页包裹 → 消毒丢弃、回退确定性', async () => {
    const deepseek = { chat: jest.fn().mockResolvedValue('<html><body><script>alert(1)</script></body></html>') };
    const { svc, store } = buildWithAi(psGen, deepseek);
    await svc.buildAndStore('p1', 'gov-blue');
    expect(store.demoHtml).not.toContain('alert(1)'); // 危险内容不进产物
    expect(store.demoHtml).toContain('一键生成'); // 不合法→回退
  });

  // 若依底座字段名归一（补模板路径的口子）：codegen 把无下划线驼峰列名小写，代理返回的行键即小写；
  // 列 key（运行时 row[key] 取值）须按底座方言归一，否则整列空白。label（表头展示）仍用模型原名。
  const camelEntities = [{ name: '客户', table: 'customer', fields: [F('id', true), F('name'), F('contactInfo'), F('userId'), F('status')] }];
  function buildBackend(backendRuntime: any) {
    const store: any = {};
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ name: '客户系统', dataModel: 'x', themeConfig: {}, planSummary: null, backendRuntime }),
        update: jest.fn().mockImplementation(({ data }: any) => { Object.assign(store, data); return Promise.resolve({}); }),
      },
    };
    const schema = { parseAndValidate: jest.fn().mockReturnValue(camelEntities) };
    return { svc: new TemplateAppService(prisma as any, schema as any), store };
  }

  it('若依底座：列 key 小写化（contactInfo→contactinfo），表头仍展示原名', async () => {
    const { svc, store } = buildBackend({ kind: 'ruoyi', status: 'ready' });
    await svc.buildAndStore('p1', 'gov-blue');
    expect(store.demoHtml).toContain('"columns":["name","contactinfo","userid","status"]'); // 数据访问键归一
    expect(store.demoHtml).toContain('<th>contactInfo</th>'); // 表头展示名不变
    expect(store.demoHtml).not.toContain('"contactInfo"'); // 不再有驼峰 key（否则取不到若依小写行键）
  });

  it('路B（无若依底座）：列 key 保持模型驼峰原名', async () => {
    const { svc, store } = buildBackend(null);
    await svc.buildAndStore('p1', 'gov-blue');
    expect(store.demoHtml).toContain('"columns":["name","contactInfo","userId","status"]'); // 不归一
  });

  // S3：buildAndStore 接 schema 驱动（composer→renderSchema），替掉固定骨架+静态占位；
  // composer 缺省/出错 → 回退旧 renderApp（现有 12 测都没注入 composer，故仍验旧路径，不破坏）。
  describe('S3 schema 驱动出页', () => {
    const schemaResult = {
      schema: { appName: '客户系统', pages: [{ key: 'dashboard', title: '工作台', nav: { icon: 'layout-dashboard', label: '工作台' }, blocks: [{ type: 'table', bind: { resource: 'company', fields: ['name'] }, props: { title: '企业列表' } }] }] },
      source: 'llm', dropped: [],
    };
    function buildWithComposer(compose: jest.Mock) {
      const store: any = {};
      const prisma = {
        project: {
          findUnique: jest.fn().mockResolvedValue({ name: '客户系统', dataModel: 'x', themeConfig: {}, planSummary: { pages: ['工作台'], features: ['剧本生成'] }, backendRuntime: null }),
          update: jest.fn().mockImplementation(({ data }: any) => { Object.assign(store, data); return Promise.resolve({}); }),
        },
      };
      const schema = { parseAndValidate: jest.fn().mockReturnValue(entities) };
      const composer = { compose } as any;
      return { svc: new TemplateAppService(prisma as any, schema as any, undefined, composer), store, compose };
    }

    it('注入 composer → 走 schema 渲染，不再出静态占位功能段', async () => {
      const compose = jest.fn().mockResolvedValue(schemaResult);
      const { svc, store } = buildWithComposer(compose);
      const r = await svc.buildAndStore('p1', 'gov-blue');
      expect(compose).toHaveBeenCalledWith(expect.objectContaining({ appName: '客户系统', dataModel: 'x', pageLabels: ['工作台'], features: ['剧本生成'] }));
      expect(store.demoHtml).toContain('"resource":"company"'); // renderSchema 的块绑定
      expect(store.demoHtml).toContain('企业列表');
      expect(store.demoHtml).not.toContain('生成结果（演示）'); // 旧 feature.template 静态占位已不出
      expect(r.theme).toBe('gov-blue');
    });

    it('composer 抛错 → 回退旧 renderApp（不崩、仍出页）', async () => {
      const compose = jest.fn().mockRejectedValue(new Error('llm down'));
      const { svc, store } = buildWithComposer(compose);
      await svc.buildAndStore('p1', 'gov-blue');
      expect(store.demoHtml).toContain('"primaryResource":"company"'); // 旧 dashboard 模板标志
      expect(store.status).toBe('demo_ready');
    });
  });

  // S4：schema 落库 + 编辑闭环（saveAppSchema 校验门→重渲染→落库；getAppSchema 返回 schema+契约）
  describe('S4 schema 编辑闭环', () => {
    const editRaw = {
      appName: '客户系统', pages: [{
        key: 'd', title: '工作台', blocks: [
          { type: 'table', bind: { resource: 'company', fields: ['name', 'level'] }, props: { title: '企业', badges: ['level'] } },
          { type: 'table', bind: { resource: 'ghost' } }, // 越界资源 → 校验门丢弃
        ],
      }],
    };
    function mk(findUnique: jest.Mock) {
      const store: any = {};
      const prisma = { project: { findUnique, update: jest.fn().mockImplementation(({ data }: any) => { Object.assign(store, data); return Promise.resolve({}); }) } };
      const schema = { parseAndValidate: jest.fn().mockReturnValue(entities) };
      return { svc: new TemplateAppService(prisma as any, schema as any), store, prisma };
    }

    it('saveAppSchema：校验门丢越界 → 重渲染 → 落库 appSchema+demoHtml', async () => {
      const find = jest.fn().mockResolvedValue({ name: '客户系统', dataModel: 'x', themeConfig: {}, backendRuntime: null });
      const { svc, store } = mk(find);
      const r = await svc.saveAppSchema('p1', editRaw);
      expect(r.dropped.some((d) => d.includes('越界资源'))).toBe(true); // ghost 被丢
      expect(r.schema.pages[0].blocks).toHaveLength(1);                 // 仅留合法 table
      expect(store.appSchema).toBeDefined();                            // schema 落库
      expect(store.demoHtml).toContain('"resource":"company"');         // 重渲染绑定
      expect(store.demoHtml).toContain('<th>name</th>');
      expect(store.status).toBe('demo_ready');
    });

    it('saveAppSchema：无合法页 → BadRequest（不偷偷存空页）', async () => {
      const find = jest.fn().mockResolvedValue({ name: 'x', dataModel: 'x', themeConfig: {}, backendRuntime: null });
      const { svc } = mk(find);
      await expect(svc.saveAppSchema('p1', { appName: 'x', pages: [{ key: 'p', title: 't', blocks: [{ type: 'ghostblock' }] }] }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('getAppSchema：返回已存 schema + 可绑数据契约（资源/字段）', async () => {
      const stored = { appName: 'x', pages: [{ key: 'd', title: '工作台', blocks: [] }] };
      const find = jest.fn().mockResolvedValue({ dataModel: 'x', backendRuntime: null, appSchema: stored });
      const { svc } = mk(find);
      const r = await svc.getAppSchema('p1');
      expect(r.schema).toEqual(stored);
      expect(r.contract.resources.map((res) => res.name)).toContain('company'); // 契约供面板选 bind
    });
  });

  it('renderAdmin：按需渲染后台控制台（管理侧栏 + 业务列表 + appData，不存库）', async () => {
    const { svc, prisma } = build('model Company { id String @id }');
    const html = await svc.renderAdmin('p1');
    expect(html).toContain('管理后台');
    expect(html).toContain('角色权限'); // 管理侧栏
    expect(html).toContain('id="adm-rows"'); // 业务列表
    expect(html).toContain('/api/app/p1/'); // appData 注入
    expect(prisma.project.update).not.toHaveBeenCalled(); // 不存库
  });
});
