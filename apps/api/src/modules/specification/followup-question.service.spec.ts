import { FollowUpQuestionService } from './followup-question.service';

describe('FollowUpQuestionService（追加问答合批）', () => {
  let req: { get: jest.Mock; apply: jest.Mock };
  let rel: { get: jest.Mock; apply: jest.Mock };
  let svc: FollowUpQuestionService;

  beforeEach(() => {
    req = { get: jest.fn(), apply: jest.fn() };
    rel = { get: jest.fn(), apply: jest.fn() };
    svc = new FollowUpQuestionService(req as never, rel as never);
  });

  describe('getQuestions', () => {
    it('合批 D 的 ask 缺口 + 关系 ask 候选成统一问题列表', async () => {
      req.get.mockResolvedValue({
        gaps: [
          { kind: 'dimension', missing: '数据权限', disposition: 'ask', question: '销售能互看客户吗？', options: ['只看自己', '都能看'] },
          { kind: 'screen', missing: '看板', disposition: 'autofill' }, // 非 ask 不进
        ],
      });
      rel.get.mockResolvedValue({
        candidates: [
          {
            parent: '客户', child: '工单', disposition: 'ask',
            questions: [
              { key: 'cardinality', question: '一个客户多个工单吗？', options: [{ label: '能', value: '1-N' }] },
              { key: 'onDelete', question: '删客户时工单？', options: [{ label: '一起删', value: 'cascade' }] },
            ],
          },
          { parent: '客户', child: '项目', disposition: 'autofill' }, // 非 ask 不进
        ],
        relations: [],
      });

      const { questions } = await svc.getQuestions('u1', 'p1');
      expect(questions).toHaveLength(3); // 1 需求 + 2 关系
      const reqQ = questions.find((q) => q.group === 'requirement')!;
      expect(reqQ).toMatchObject({ id: 'gap:数据权限', title: '数据权限', missing: '数据权限' });
      expect(reqQ.options).toEqual([{ label: '只看自己', value: '只看自己' }, { label: '都能看', value: '都能看' }]);
      const relQ = questions.filter((q) => q.group === 'relation');
      expect(relQ.map((q) => q.id)).toEqual(['rel:客户->工单:cardinality', 'rel:客户->工单:onDelete']);
      expect(relQ[0].relationKey).toBe('客户->工单');
    });

    it('无 ask 项 → 空列表（前端据此不弹窗）', async () => {
      req.get.mockResolvedValue({ gaps: [{ kind: 'screen', missing: 'x', disposition: 'autofill' }] });
      rel.get.mockResolvedValue({ candidates: [{ parent: 'a', child: 'b', disposition: 'autofill' }], relations: [] });
      const { questions } = await svc.getQuestions('u1', 'p1');
      expect(questions).toEqual([]);
    });

    it('ask 缺口缺 question/options → 不进列表（不抛半成品）', async () => {
      req.get.mockResolvedValue({ gaps: [{ kind: 'flow', missing: '审批', disposition: 'ask' }] });
      rel.get.mockResolvedValue({ candidates: [], relations: [] });
      const { questions } = await svc.getQuestions('u1', 'p1');
      expect(questions).toEqual([]);
    });
  });

  describe('submit', () => {
    it('relations 答案路由关系 apply、acceptGaps 路由需求 apply', async () => {
      rel.apply.mockResolvedValue({ relations: [{ parent: '客户', child: '工单' }] });
      req.apply.mockResolvedValue({ added: { pages: [] }, specSync: 'noop' });

      const r = await svc.submit('u1', 'p1', {
        relations: { '客户->工单': { cardinality: '1-N', onDelete: 'cascade' } },
        acceptGaps: ['数据看板'],
      });
      expect(rel.apply).toHaveBeenCalledWith('u1', 'p1', { '客户->工单': { cardinality: '1-N', onDelete: 'cascade' } });
      expect(req.apply).toHaveBeenCalledWith('u1', 'p1', ['数据看板']);
      expect(r.relations).toHaveLength(1);
    });

    it('空提交 → 各自用空默认调（不崩）', async () => {
      rel.apply.mockResolvedValue({ relations: [] });
      req.apply.mockResolvedValue({});
      await svc.submit('u1', 'p1', {});
      expect(rel.apply).toHaveBeenCalledWith('u1', 'p1', {});
      expect(req.apply).toHaveBeenCalledWith('u1', 'p1', []);
    });
  });
});
