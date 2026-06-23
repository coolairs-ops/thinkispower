import { coerceSchema, fallbackSchema, extractJson } from './schema-composer';
import { SchemaComposerService } from './schema-composer.service';
import { DataContract } from '../app-contract';

const contract: DataContract = {
  resources: [
    { name: 'project', fields: ['title', 'genre', 'createdAt'] },
    { name: 'user', fields: ['email', 'name'] },
  ],
};

describe('coerceSchema（Schema 驱动 S2 校验门：零信任 LLM）', () => {
  it('合法块保留，未知块类型/越界资源/越界字段丢弃并记 dropped', () => {
    const raw = {
      appName: '短剧平台',
      pages: [{
        key: '工作台', title: '工作台',
        blocks: [
          { type: 'kpi', bind: { resource: 'project' }, props: { label: '项目数' } },
          { type: 'table', bind: { resource: 'project', fields: ['title', '不存在的字段'] }, props: { title: '历史' } },
          { type: 'chart', bind: { resource: 'project' } },          // 未知块类型 → 丢
          { type: 'table', bind: { resource: '幽灵表' }, props: {} }, // 越界资源 → 丢
        ],
      }],
    };
    const { schema, dropped } = coerceSchema(raw, contract);
    expect(schema).not.toBeNull();
    expect(schema!.pages).toHaveLength(1);
    expect(schema!.pages[0].blocks).toHaveLength(2); // kpi + table（保留）
    const table = schema!.pages[0].blocks.find((b) => b.type === 'table') as any;
    expect(table.bind.fields).toEqual(['title']);     // 越界字段被过滤
    expect(schema!.pages[0].key).toBe('p0');           // 中文 key → slug 兜底
    expect(dropped.some((d) => d.includes('未知块类型'))).toBe(true);
    expect(dropped.some((d) => d.includes('越界资源'))).toBe(true);
    expect(dropped.some((d) => d.includes('越界字段'))).toBe(true);
  });

  it('字段缺省 → 退回该资源前若干字段', () => {
    const { schema } = coerceSchema({ appName: 'x', pages: [{ key: 'p', title: 't', blocks: [{ type: 'table', bind: { resource: 'project' } }] }] }, contract);
    const t = schema!.pages[0].blocks[0] as any;
    expect(t.bind.fields).toEqual(['title', 'genre', 'createdAt']);
  });

  it('全越界/根结构非法 → schema=null（调用方兜底）', () => {
    expect(coerceSchema({ appName: 'x', pages: [{ key: 'p', title: 't', blocks: [{ type: 'bogus' }] }] }, contract).schema).toBeNull();
    expect(coerceSchema({ nope: 1 }, contract).schema).toBeNull();
    expect(coerceSchema('not object', contract).schema).toBeNull();
  });
});

describe('fallbackSchema（确定性兜底）', () => {
  it('跳过通用 user 选业务资源，主资源出工作台 KPI+列表，其余各一页', () => {
    const s = fallbackSchema('短剧平台', contract);
    expect(s.pages[0].key).toBe('dashboard');
    expect(s.pages[0].blocks[0].type).toBe('kpi');
    expect((s.pages[0].blocks[1] as any).bind.resource).toBe('project'); // 非 user
    expect(s.pages.some((p) => p.blocks.some((b) => (b as any).bind?.resource === 'user'))).toBe(false);
  });

  it('空契约 → 不崩，出占位 richtext 页', () => {
    const s = fallbackSchema('x', { resources: [] });
    expect(s.pages[0].blocks[0].type).toBe('richtext');
  });
});

describe('extractJson', () => {
  it('去 ```json 围栏后解析；垃圾 → null', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('前言 {"a":2} 后语')).toEqual({ a: 2 });
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('SchemaComposerService.compose', () => {
  const model = [{ name: 'Project', table: 'project', fields: [{ name: 'title' }, { name: 'userId' }] }];
  const mkSchema = () => ({ parseAndValidate: jest.fn().mockReturnValue(model) });

  it('LLM 产合法 schema → source=llm', async () => {
    const deepseek = { chatWithRetry: jest.fn().mockResolvedValue('```json\n{"appName":"短剧","pages":[{"key":"d","title":"工作台","blocks":[{"type":"table","bind":{"resource":"project","fields":["title"]}}]}]}\n```') };
    const svc = new SchemaComposerService(mkSchema() as any, deepseek as any);
    const r = await svc.compose({ appName: '短剧', dataModel: 'x' });
    expect(r.source).toBe('llm');
    expect(r.schema.pages).toHaveLength(1);
  });

  it('LLM 抛错 → 退回确定性兜底', async () => {
    const deepseek = { chatWithRetry: jest.fn().mockRejectedValue(new Error('timeout')) };
    const svc = new SchemaComposerService(mkSchema() as any, deepseek as any);
    const r = await svc.compose({ appName: '短剧', dataModel: 'x' });
    expect(r.source).toBe('fallback');
    expect(r.schema.pages[0].key).toBe('dashboard');
  });

  it('无 deepseek → 纯兜底', async () => {
    const svc = new SchemaComposerService(mkSchema() as any);
    const r = await svc.compose({ appName: '短剧', dataModel: 'x' });
    expect(r.source).toBe('fallback');
  });

  it('若依底座 → bind 字段名按方言归一（userId→userid）', async () => {
    const svc = new SchemaComposerService(mkSchema() as any); // 无 deepseek 走兜底，仍证契约归一带进 schema
    const r = await svc.compose({ appName: '短剧', dataModel: 'x', backendKind: 'ruoyi' });
    const fields = (r.schema.pages[0].blocks[1] as any).bind.fields as string[];
    expect(fields).toContain('userid');
    expect(fields).not.toContain('userId');
  });
});
