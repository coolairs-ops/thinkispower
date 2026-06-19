import { TraceabilityValidator } from './traceability-validator.service';

describe('TraceabilityValidator · extractAcceptanceCriteria 去重', () => {
  let deepseek: { chat: jest.Mock };
  let qwen: { available: boolean; chat: jest.Mock };
  let svc: TraceabilityValidator;

  beforeEach(() => {
    deepseek = { chat: jest.fn().mockResolvedValue('{"traceability":[],"coverage":100,"missing":[]}') };
    qwen = { available: false, chat: jest.fn() };
    svc = new TraceabilityValidator(deepseek as never, qwen as never);
  });

  /** 从送给评测模型的 userMessage 里抽出"需求清单"行，验证去重效果 */
  const criteriaSentTo = (mock: jest.Mock): string[] => {
    const userMsg: string = mock.mock.calls[0][0][1].content;
    return userMsg
      .split('\n')
      .filter((l) => /^\d+\.\s/.test(l))
      .map((l) => l.replace(/^\d+\.\s*/, '').trim());
  };

  it('同一需求从多个源（features / mvpScope / pages）重复收集时只评一次', async () => {
    await svc.validate(
      'p1',
      '<html></html>',
      { features: ['多用户权限与云端同步', '客户列表'], pages: ['客户列表'] },
      { prd: { mvpScope: ['多用户权限与云端同步'], features: ['多用户权限与云端同步'] } },
    );
    const sent = criteriaSentTo(deepseek.chat);
    // "多用户权限与云端同步" 出现在 features+mvpScope+prd.features 三处 → 去重后只 1 条
    const dup = sent.filter((c) => c.includes('多用户权限与云端同步'));
    expect(dup).toHaveLength(1);
    // "客户列表" 在 features 与 pages 各一次 → 去重后只 1 条
    const cust = sent.filter((c) => c.includes('客户列表'));
    expect(cust).toHaveLength(1);
  });

  it('不同内容的需求保留（前缀不同但内容不同不误删）', async () => {
    await svc.validate(
      'p2',
      '<html></html>',
      { pages: ['客户列表', '客户详情'], features: ['搜索筛选'] },
      {},
    );
    const sent = criteriaSentTo(deepseek.chat);
    expect(sent.some((c) => c.includes('客户列表'))).toBe(true);
    expect(sent.some((c) => c.includes('客户详情'))).toBe(true);
    expect(sent.some((c) => c.includes('搜索筛选'))).toBe(true);
    expect(sent).toHaveLength(3);
  });
});
