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
      {} as never, {} as never, {} as never,
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
