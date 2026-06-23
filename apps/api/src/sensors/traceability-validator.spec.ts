import { TraceabilityValidator } from './traceability-validator.service';

/** LLM 桩：把送入的 self 需求全判 found（便于验证分桶/覆盖率数学） */
const chatAllFound = (msgs: any[]) => {
  const userMsg: string = msgs[1].content;
  const crits = userMsg.split('\n').filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').trim());
  return Promise.resolve(JSON.stringify({ traceability: crits.map((c) => ({ requirement: c, found: true, score: 100, evidence: 'ok' })), coverage: 100, missing: [] }));
};

function makeSvc(chatImpl: (msgs: any[]) => Promise<string> = chatAllFound) {
  const deepseek = { chat: jest.fn(chatImpl) };
  const qwen = { available: false, chat: jest.fn() };
  const svc = new TraceabilityValidator(deepseek as never, qwen as never);
  return { svc, deepseek };
}

/** 从送给评测模型的 userMessage 里抽出"需求清单"行 */
const criteriaSentTo = (mock: jest.Mock): string[] => {
  if (mock.mock.calls.length === 0) return [];
  const userMsg: string = mock.mock.calls[0][0][1].content;
  return userMsg.split('\n').filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').trim());
};

describe('TraceabilityValidator · extractAcceptanceCriteria 去重', () => {
  it('同一需求从多个源（features / mvpScope / pages）重复收集时只评一次', async () => {
    const { svc, deepseek } = makeSvc();
    await svc.validate(
      'p1',
      '<html></html>',
      { features: ['客户列表', '搜索筛选'], pages: ['客户列表'] },
      { prd: { mvpScope: ['客户列表'], features: ['客户列表'] } },
    );
    const sent = criteriaSentTo(deepseek.chat);
    expect(sent.filter((c) => c.includes('客户列表'))).toHaveLength(1);
    expect(sent.filter((c) => c.includes('搜索筛选'))).toHaveLength(1);
  });

  it('不同内容的需求保留（前缀不同但内容不同不误删）', async () => {
    const { svc, deepseek } = makeSvc();
    await svc.validate('p2', '<html></html>', { pages: ['客户列表', '客户详情'], features: ['搜索筛选'] }, {});
    const sent = criteriaSentTo(deepseek.chat);
    expect(sent).toEqual(expect.arrayContaining([expect.stringContaining('客户列表'), expect.stringContaining('客户详情'), expect.stringContaining('搜索筛选')]));
    expect(sent).toHaveLength(3);
  });
});

describe('TraceabilityValidator · 能力来源分流（ADR-0008）', () => {
  it('只把 self 需求送 LLM 判 HTML；backend/external/deferred 不送', async () => {
    const { svc, deepseek } = makeSvc();
    await svc.validate(
      'p',
      '<html></html>',
      { features: ['客户列表', '多用户权限管理', '工单语音转写', '高级报表本期不做'] },
      {},
    );
    const sent = criteriaSentTo(deepseek.chat);
    expect(sent.some((c) => c.includes('客户列表'))).toBe(true); // self
    expect(sent.some((c) => c.includes('多用户权限'))).toBe(false); // backend
    expect(sent.some((c) => c.includes('语音转写'))).toBe(false); // external
    expect(sent.some((c) => c.includes('本期不做'))).toBe(false); // deferred
  });

  it('backend 已置备 → 信用满分（1 self found + 1 backend ready = 覆盖 100）', async () => {
    const { svc } = makeSvc();
    const r = await svc.validate('p', '<html></html>', { features: ['客户列表', '多用户权限管理'] }, {}, { backendReady: true });
    expect(r.score).toBe(100);
    expect(r.passed).toBe(true);
  });

  it('backend 未置备 → 该项计未实现（覆盖 50）', async () => {
    const { svc } = makeSvc();
    const r = await svc.validate('p', '<html></html>', { features: ['客户列表', '多用户权限管理'] }, {}, { backendReady: false });
    expect(r.score).toBe(50);
    const raw = JSON.parse(r.rawOutput!);
    expect(raw.missing.some((m: string) => m.includes('多用户权限') && m.includes('待后端置备'))).toBe(true);
  });

  it('external 标"待对接"、不算未实现、移出分母（1 self found + 1 external = 覆盖 100）', async () => {
    const { svc } = makeSvc();
    const r = await svc.validate('p', '<html></html>', { features: ['客户列表', '工单语音转写'] }, {}, { backendReady: false });
    expect(r.score).toBe(100); // external 不进分母，分母=1(self)，self found → 100
    const raw = JSON.parse(r.rawOutput!);
    expect(raw.missing).toHaveLength(0);
    expect(raw.external).toHaveLength(1);
    expect(raw.external[0].protocol).toBe('asr');
    expect(r.checks.some((c) => c.name.includes('外部能力待对接汇总'))).toBe(true);
  });

  it('deferred 完全移出分母', async () => {
    const { svc } = makeSvc();
    const r = await svc.validate('p', '<html></html>', { features: ['客户列表', '高级报表本期不做'] }, {}, {});
    expect(r.score).toBe(100); // 分母只算 self=1
    const raw = JSON.parse(r.rawOutput!);
    expect(raw.buckets).toEqual({ self: 1, backend: 0, external: 0, deferred: 1 });
  });

  it('self 判定服务降级时只拖累 self 桶，backend 仍确定性信用', async () => {
    const { svc } = makeSvc(() => Promise.reject(new Error('llm down')));
    const r = await svc.validate('p', '<html></html>', { features: ['客户列表', '多用户权限管理'] }, {}, { backendReady: true });
    // self(1) 降级计未实现、backend(1) ready 信用 → 覆盖 50（而非整体归零）
    expect(r.score).toBe(50);
  });
});
