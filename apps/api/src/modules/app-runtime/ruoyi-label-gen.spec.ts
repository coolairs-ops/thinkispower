import { generateConsoleLabels } from './ruoyi-label-gen';

const entity = (table: string, name: string, fields: string[]) => ({ table, name, fields: fields.map((n) => ({ name: n })) }) as never;

describe('generateConsoleLabels 确定性兜底(ADR-0012 ①，LLM 抽风也不裸回退英文)', () => {
  it('无 deepseek → 用词典产中文(常见字段/实体)，不返空', async () => {
    const r = await generateConsoleLabels(undefined, [entity('store', 'Store', ['name', 'address', 'phone', 'status', 'createdAt'])]);
    expect(r.store.functionName).toBe('门店');
    expect(r.store.columns).toMatchObject({ name: '名称', address: '地址', phone: '电话', status: '状态', createdAt: '创建时间' });
  });

  it('框架列(create_by/tenant_id 等)不译、不进 columns', async () => {
    const r = await generateConsoleLabels(undefined, [entity('task', 'Task', ['title', 'create_by', 'tenant_id', 'del_flag'])]);
    expect(r.task.columns).toEqual({ title: '标题' });
  });

  it('字段名归一：camelCase / snake_case 同等命中(customerId 与 customer_id)', async () => {
    const r = await generateConsoleLabels(undefined, [entity('visitrecord', 'VisitRecord', ['customerId', 'visit_time', 'photoUrls', 'inspectorId'])]);
    expect(r.visitrecord.columns).toMatchObject({ customerId: '客户', visit_time: '拜访时间', photoUrls: '照片', inspectorId: '检查人' });
  });

  it('词典未命中的生僻字段 → 不塞(留给 LLM/英文)，不报错', async () => {
    const r = await generateConsoleLabels(undefined, [entity('x', 'X', ['zzzWeirdField'])]);
    expect(r.x.columns).toEqual({});
    expect(r.x.functionName).toBe('X'); // 实体名兜底
  });

  it('LLM 成功时按字段覆盖兜底(更贴业务)', async () => {
    const deepseek = {
      chatWithRetry: jest.fn(async () => '{"store":{"functionName":"连锁门店","columns":{"name":"门店名称"}}}'),
    } as never;
    const r = await generateConsoleLabels(deepseek, [entity('store', 'Store', ['name', 'phone'])]);
    expect(r.store.functionName).toBe('连锁门店'); // LLM 覆盖兜底"门店"
    expect(r.store.columns.name).toBe('门店名称'); // LLM 覆盖兜底"名称"
    expect(r.store.columns.phone).toBe('电话'); // LLM 没给 → 保留兜底
  });

  it('LLM 抽风(返空)→ 回退确定性兜底，不返空', async () => {
    const deepseek = { chatWithRetry: jest.fn(async () => null) } as never;
    const r = await generateConsoleLabels(deepseek, [entity('store', 'Store', ['name'])]);
    expect(r.store.columns.name).toBe('名称');
  });
});
