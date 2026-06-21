import { BadRequestException } from '@nestjs/common';
import { TemplateAppService } from './template-app.service';

const F = (name: string, isId = false) => ({ name, prismaType: 'String', optional: false, isId, isUnique: false });
const entities = [{ name: '企业', table: 'company', fields: [F('id', true), F('name'), F('level'), F('score'), F('status'), F('createdAt')] }];

function build(dataModel: string | null) {
  const store: any = {};
  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue({ name: '企业风险监管平台', dataModel, themeConfig: {} }),
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
});
