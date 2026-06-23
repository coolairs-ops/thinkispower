import { DeliveryIterationService } from './delivery-iteration.service';

/**
 * autoFixWholeHtml 防退化护栏（方案 A）：
 * 整块修复在 prompt 里截断 HTML，LLM 易据截断版重写而丢内容/丢批注，使 L1 越改越差。
 * 护栏：结果显著缩水（<85%）或批注数（data-module-key / data-element-path）下降 → 丢弃本轮（返回 null）。
 */
describe('DeliveryIterationService.autoFixWholeHtml 防退化护栏', () => {
  let service: DeliveryIterationService;
  let chat: jest.Mock;

  // 原始 HTML：3 个 module-key + 4 个 element-path 批注 + 约 1.2KB 填充
  const filler = 'x'.repeat(1200);
  const currentHtml =
    `<!DOCTYPE html><html><body>` +
    `<div data-module-key="a" data-element-path="a/1">A</div>` +
    `<div data-module-key="b" data-element-path="b/1">B</div>` +
    `<div data-module-key="c" data-element-path="c/1" data-element-path="c/2">C</div>` +
    `<!-- ${filler} --></body></html>`;

  const wrap = (html: string) => '```html\n' + html + '\n```';

  beforeEach(() => {
    chat = jest.fn();
    const deepseek = { chat } as unknown;
    service = new DeliveryIterationService(
      {} as never, {} as never, {} as never, deepseek as never,
      {} as never, {} as never, {} as never, {} as never,
    );
  });

  const callFix = (): Promise<string | null> =>
    (service as unknown as { autoFixWholeHtml: (h: string, r: string[]) => Promise<string | null> })
      .autoFixWholeHtml(currentHtml, ['修复建议']);

  it('健康修复：尺寸相近且批注不减 → 接受', async () => {
    chat.mockResolvedValue(wrap(currentHtml.replace('A</div>', 'A!</div>')));
    const res = await callFix();
    expect(res).toBeTruthy();
    expect((res!.match(/data-element-path/g) || []).length).toBe(4);
  });

  it('显著缩水（<85%）→ 判退化丢弃，返回 null', async () => {
    const shrunk =
      `<!DOCTYPE html><html><body>` +
      `<div data-module-key="a" data-element-path="a/1">A</div>` +
      `<!-- ${'y'.repeat(550)} --></body></html>`; // >500 字节避开旧的无效守卫，但 <85% 触发缩水守卫
    chat.mockResolvedValue(wrap(shrunk));
    expect(await callFix()).toBeNull();
  });

  it('批注退化（element-path 4→3）→ 丢弃，返回 null', async () => {
    const sameSize =
      `<!DOCTYPE html><html><body>` +
      `<div data-module-key="a" data-element-path="a/1">A</div>` +
      `<div data-module-key="b" data-element-path="b/1">B</div>` +
      `<div data-module-key="c" data-element-path="c/1">C</div>` + // 去掉 c/2，批注 4→3
      `<!-- ${filler} --></body></html>`;
    chat.mockResolvedValue(wrap(sameSize));
    expect(await callFix()).toBeNull();
  });
});

/**
 * 自迭代迁 BullMQ：startAutoIterate 改为「拿全局锁 → 入队 AUTO_ITERATE_JOB」，
 * 不再进程内 fire-and-forget（进程重启即孤儿）。崩溃恢复靠 BullMQ stalled 重拨。
 */
describe('DeliveryIterationService.startAutoIterate 入队（BullMQ 迁移）', () => {
  const build = (queueAdd: jest.Mock) => {
    let captured: { id: string; projectId: string; taskId: string } | undefined;
    const systemLock = {
      findUnique: jest.fn().mockImplementation(async () => captured ?? null),
      upsert: jest.fn().mockImplementation(async ({ create }: any) => { captured = create; return create; }),
      delete: jest.fn().mockImplementation(async () => { captured = undefined; return {}; }),
    };
    const prisma = { systemLock } as unknown;
    const queue = { add: queueAdd } as unknown;
    const service = new DeliveryIterationService(
      prisma as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, queue as never,
    );
    return { service, systemLock };
  };

  it('获取全局锁后入队 AUTO_ITERATE_JOB，不再进程内直接执行', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const { service, systemLock } = build(add);
    const executeSpy = jest
      .spyOn(service, 'executeAutoIterate')
      .mockResolvedValue(undefined as never);

    const { taskId } = await service.startAutoIterate('proj-1234abcd');

    expect(systemLock.upsert).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      'auto-iterate',
      { taskId, projectId: 'proj-1234abcd' },
      expect.objectContaining({ attempts: 1 }),
    );
    expect(executeSpy).not.toHaveBeenCalled(); // 入队，不再 fire-and-forget
  });

  it('入队失败 → 释放刚获取的锁并抛出（不留孤儿锁）', async () => {
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    const { service, systemLock } = build(add);

    await expect(service.startAutoIterate('proj-1234abcd')).rejects.toThrow('redis down');
    expect(systemLock.delete).toHaveBeenCalledWith({ where: { id: 'auto_iteration' } });
  });
});

/**
 * S5：自迭代修复改 schema 而非改 HTML。autoFixViaSchema 对 schema 驱动项目走 reviseSchema→重渲染→
 * 持久 appSchema；非 schema 项目返回 null（调用方回退 HTML 版 autoFix）。
 */
describe('DeliveryIterationService.autoFixViaSchema (S5)', () => {
  const mk = (findUnique: jest.Mock, composer: any) => {
    const store: any = {};
    const prisma = { project: { findUnique, update: jest.fn().mockImplementation(({ data }: any) => { Object.assign(store, data); return Promise.resolve({}); }) } };
    const svc = new DeliveryIterationService(
      prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, undefined, composer as never,
    );
    return { svc, store };
  };

  it('有 appSchema 且修订有变化 → 重渲染 + 持久修订后的 appSchema，返回新 HTML', async () => {
    const appSchema = { appName: 'x', pages: [{ key: 'd', title: 't', blocks: [{ type: 'table', bind: { resource: 'r', fields: ['a'] } }] }] };
    const revised = { appName: 'x', pages: [{ key: 'd', title: 't', blocks: [{ type: 'table', bind: { resource: 'r', fields: ['a', 'b'] } }] }] };
    const find = jest.fn().mockResolvedValue({ dataModel: 'x', backendRuntime: null, appSchema });
    const composer = { reviseSchema: jest.fn().mockResolvedValue({ schema: revised, dropped: [], changed: true }) };
    const { svc, store } = mk(find, composer);
    const html = await (svc as any).autoFixViaSchema('p1', ['加字段 b']);
    expect(html).toContain('"resource":"r"');   // renderSchema 输出
    expect(store.appSchema).toEqual(revised);    // 持久修订后的 schema
    expect(composer.reviseSchema).toHaveBeenCalled();
  });

  it('无 appSchema → 返回 null，不调 reviseSchema（回退 HTML 修复）', async () => {
    const find = jest.fn().mockResolvedValue({ dataModel: 'x', backendRuntime: null, appSchema: null });
    const composer = { reviseSchema: jest.fn() };
    const { svc } = mk(find, composer);
    expect(await (svc as any).autoFixViaSchema('p1', ['x'])).toBeNull();
    expect(composer.reviseSchema).not.toHaveBeenCalled();
  });

  it('修订无变化（changed=false）→ 返回 null', async () => {
    const appSchema = { appName: 'x', pages: [{ key: 'd', title: 't', blocks: [{ type: 'table', bind: { resource: 'r', fields: ['a'] } }] }] };
    const find = jest.fn().mockResolvedValue({ dataModel: 'x', backendRuntime: null, appSchema });
    const composer = { reviseSchema: jest.fn().mockResolvedValue({ schema: appSchema, dropped: [], changed: false }) };
    const { svc } = mk(find, composer);
    expect(await (svc as any).autoFixViaSchema('p1', ['x'])).toBeNull();
  });
});
