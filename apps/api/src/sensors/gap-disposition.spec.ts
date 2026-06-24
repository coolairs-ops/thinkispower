import { disposeGap } from './gap-disposition';

describe('disposeGap（缺口处置策略 · ADR-0008 D6）', () => {
  it('self + 生成器能产(green) → 自迭代（自闭合）', () => {
    const d = disposeGap({ fulfilledBy: 'self', maturity: 'green', capId: 'PLG-crud' });
    expect(d.action).toBe('auto-iterate');
    expect(d.channel).toBe('iterate');
    expect(d.autoCloseable).toBe(true);
  });

  it('self + 无 maturity 标注（注册表未命中）→ 仍按能产自迭代', () => {
    expect(disposeGap({ fulfilledBy: 'self' }).action).toBe('auto-iterate');
  });

  it('self + 缺 block(red) → 扩生成器词汇工单，不进自迭代', () => {
    const d = disposeGap({ fulfilledBy: 'self', maturity: 'red', capId: 'PLG-chat-qa' });
    expect(d.action).toBe('extend-generator');
    expect(d.channel).toBe('gap-workflow');
    expect(d.autoCloseable).toBe(false); // 关键：不让自迭代空转撞墙
  });

  it('external → 标准端口适配器 + 工单', () => {
    const d = disposeGap({ fulfilledBy: 'external', protocol: 'asr' });
    expect(d.action).toBe('external-adapter');
    expect(d.channel).toBe('gap-workflow');
    expect(d.reason).toContain('asr');
  });

  it('backend → 后端置备（自闭合）', () => {
    const d = disposeGap({ fulfilledBy: 'backend' });
    expect(d.action).toBe('backend-provision');
    expect(d.channel).toBe('provision');
    expect(d.autoCloseable).toBe(true);
  });

  it('deferred/品类外 → 转人工，不自动闭合', () => {
    const d = disposeGap({ fulfilledBy: 'deferred' });
    expect(d.action).toBe('out-of-scope');
    expect(d.channel).toBe('human');
    expect(d.autoCloseable).toBe(false);
  });

  it('每条都给客户侧动作（不暴露内部术语）', () => {
    for (const fb of ['self', 'backend', 'external', 'deferred'] as const) {
      expect(disposeGap({ fulfilledBy: fb }).customerAction).toBeTruthy();
    }
  });
});
