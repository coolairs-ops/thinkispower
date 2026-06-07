import { ConflictDetectionService, ConflictDoc } from './conflict-detection.service';

describe('ConflictDetectionService', () => {
  let llm: { chat: jest.Mock };
  let service: ConflictDetectionService;

  const docA: ConflictDoc = { fileName: 'PRD.docx', summary: '商城', features: ['游客可下单'], roles: ['游客', '管理员'] };
  const docB: ConflictDoc = { fileName: '补充.md', summary: '商城', features: ['下单需登录'], roles: ['会员'] };

  beforeEach(() => {
    llm = { chat: jest.fn() };
    service = new ConflictDetectionService(llm as never);
  });

  it('不足两份有内容的资料 → 直接返回 []，不调 LLM', async () => {
    expect(await service.detect([docA])).toEqual([]);
    expect(await service.detect([docA, { fileName: '空.txt' }])).toEqual([]);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('LLM 返回冲突 → 规范化(kind/severity 兜底、过滤无 claim)', async () => {
    llm.chat.mockResolvedValue(JSON.stringify({
      conflicts: [
        {
          topic: '下单是否需登录', kind: 'contradiction', severity: 'high',
          statements: [
            { source: 'PRD.docx', claim: '游客可下单' },
            { source: '补充.md', claim: '下单需登录' },
            { source: '补充.md' }, // 无 claim → 过滤
          ],
          suggestion: '与业务确认是否允许游客下单',
        },
        { topic: '角色口径', kind: 'weird', severity: 'x', statements: [{ source: 'PRD.docx', claim: '管理员' }], suggestion: '' },
        { kind: 'omission' }, // 无 topic → 丢弃
      ],
    }));

    const r = await service.detect([docA, docB]);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual(expect.objectContaining({ topic: '下单是否需登录', kind: 'contradiction', severity: 'high' }));
    expect(r[0].statements).toHaveLength(2); // 无 claim 的被过滤
    // 非法 kind/severity 兜底
    expect(r[1]).toEqual(expect.objectContaining({ topic: '角色口径', kind: 'inconsistency', severity: 'medium' }));
  });

  it('LLM 异常 → 返回 []，不抛错', async () => {
    llm.chat.mockRejectedValue(new Error('llm down'));
    expect(await service.detect([docA, docB])).toEqual([]);
  });

  it('LLM 返回非法 JSON → 返回 []', async () => {
    llm.chat.mockResolvedValue('抱歉我无法分析');
    expect(await service.detect([docA, docB])).toEqual([]);
  });

  it('无冲突 → conflicts:[] 返回 []', async () => {
    llm.chat.mockResolvedValue(JSON.stringify({ conflicts: [] }));
    expect(await service.detect([docA, docB])).toEqual([]);
  });

  it('fromParsed 从 parseSummary 列表构造输入', () => {
    const docs = ConflictDetectionService.fromParsed([
      { fileName: 'a.txt', s: { status: 'parsed', summary: 's', features: ['f'], roles: ['r'], notes: 'n' } },
    ]);
    expect(docs[0]).toEqual(expect.objectContaining({ fileName: 'a.txt', summary: 's', features: ['f'], roles: ['r'], notes: 'n' }));
  });
});
