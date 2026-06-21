import { KnowledgeSourceService } from './knowledge-source.service';
import { KnowledgeService } from './knowledge.service';
import { FactExtractor } from './knowledge.types';

const 报告文本 = `河北荷花池药业有限公司。该企业已累计接受3次飞行检查；累计被通报不合格药品13批次；曾被发出告诫信1份。建议风险等级"D级（高风险）"。`;

// 注入桩提取器（替代真实 LLM）：含一条编造的99批次证校验门
const 桩: FactExtractor = () => [
  { name: '飞检次数', value: 3, quote: '累计接受3次飞行检查' },
  { name: '不合格批次数', value: 13, quote: '累计被通报不合格药品13批次' },
  { name: '不合格批次数', value: 99, quote: '累计被通报不合格药品99批次' }, // 编造
];

function makeSvc() {
  const store: { sr: any } = { sr: {} };
  const prisma = {
    project: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ userId: 'u1', structuredRequirement: store.sr })),
      update: jest.fn().mockImplementation(({ data }: any) => { store.sr = data.structuredRequirement; return Promise.resolve({}); }),
    },
  };
  const minio = { uploadFile: jest.fn().mockResolvedValue('http://minio/x') };
  const llm = { extract: jest.fn() }; // 不应被调用（注入了桩）
  const svc = new KnowledgeSourceService(prisma as any, minio as any, new KnowledgeService(), llm as any);
  return { svc, prisma, minio, llm, store };
}

const file = { buffer: Buffer.from(报告文本, 'utf8'), originalname: '荷花池报告.txt', mimetype: 'text/plain' };

describe('KnowledgeSourceService 文档上传链路（接入轨 ②）', () => {
  it('上传 → 落 MinIO + 抽文本 + 校验门 → 候选持久化（编造的99作废、严重缺陷数缺失）', async () => {
    const { svc, minio, store } = makeSvc();
    const { sourceId, candidates } = await svc.uploadSource('p1', file, ['严重缺陷数'], 桩);

    expect(minio.uploadFile).toHaveBeenCalledWith(expect.stringContaining('knowledge/p1/'), file.buffer, expect.anything());
    expect(sourceId).toBe('SRC-1');
    expect(candidates.find((f) => f.value === 13)!.status).toBe('candidate');
    expect(candidates.find((f) => f.value === 99)!.status).toBe('rejected'); // 校验门
    expect(candidates.find((f) => f.name === '严重缺陷数')!.status).toBe('missing');
    // 已持久化进 structuredRequirement.knowledgeBase
    expect(store.sr.knowledgeBase.sources).toHaveLength(1);
    expect(store.sr.knowledgeBase.sources[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(store.sr.knowledgeBase.sources[0].storage_ref).toContain('knowledge/p1/');
  });

  it('确认 → confirmed + 证据链回指；再读带 trace', async () => {
    const { svc } = makeSvc();
    const { candidates } = await svc.uploadSource('p1', file, [], 桩);
    const realId = candidates.find((f) => f.value === 13)!.fact_id;
    await svc.confirmFacts('p1', [realId], '张审核', '2026-06-21T09:00:00Z');

    const kb = await svc.loadWithTrace('p1');
    const f13 = kb.facts.find((f) => f.fact_id === realId)!;
    expect(f13.status).toBe('confirmed');
    expect(f13.confirmed_by).toBe('张审核');
    const t = kb.trace.find((x) => x.value === 13)!;
    expect(t.quote).toContain('13批次');
    expect(t.verified).toBe(true);
    expect(t.sourceTitle).toContain('荷花池');
  });

  it('否决 → rejected（不进评分）', async () => {
    const { svc } = makeSvc();
    const { candidates } = await svc.uploadSource('p1', file, [], 桩);
    const id = candidates.find((f) => f.value === 3)!.fact_id;
    await svc.rejectFacts('p1', [id]);
    const kb = await svc.loadKB('p1');
    expect(kb.facts.find((f) => f.fact_id === id)!.status).toBe('rejected');
  });

  it('两次上传 id 不撞（seq namespacing）', async () => {
    const { svc } = makeSvc();
    const r1 = await svc.uploadSource('p1', file, [], 桩);
    const r2 = await svc.uploadSource('p1', file, [], 桩);
    expect(r1.sourceId).toBe('SRC-1');
    expect(r2.sourceId).toBe('SRC-2');
    const kb = await svc.loadKB('p1');
    expect(new Set(kb.facts.map((f) => f.fact_id)).size).toBe(kb.facts.length); // 无重复 id
  });
});
