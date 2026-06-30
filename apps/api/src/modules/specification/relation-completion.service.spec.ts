import { ForbiddenException } from '@nestjs/common';
import { RelationCompletionService } from './relation-completion.service';

describe('RelationCompletionService（实体关系补全 · Phase 2a）', () => {
  let prisma: any;
  let deepseek: { chat: jest.Mock };
  let svc: RelationCompletionService;

  const project = {
    userId: 'u1',
    name: '门店CRM',
    planSummary: { dataObjects: ['客户', '项目'], pages: ['客户详情'], features: ['客户管理'] },
    structuredRequirement: { designSuggestions: [{ title: '三级跳转', description: '客户→详情→项目' }] },
  };

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue(project), update: jest.fn().mockResolvedValue({}) },
    };
    deepseek = { chat: jest.fn() };
    svc = new RelationCompletionService(prisma as never, deepseek as never);
  });

  describe('detect', () => {
    it('检测候选关系，存到 relationCandidates；autofill/ask 都解析', async () => {
      deepseek.chat.mockResolvedValue(
        JSON.stringify([
          { parent: '客户', child: '项目', cardinality: '1-N', fkField: 'customerId', evidence: '客户详情含项目列表', source: 'page', disposition: 'autofill' },
          {
            parent: '客户', child: '工单', cardinality: '1-N', source: 'llm', disposition: 'ask',
            questions: [{ key: 'cardinality', question: '一个客户多个工单吗？', options: [{ label: '能', value: '1-N' }] }],
          },
        ]),
      );
      const r = await svc.detect('u1', null, 'p1');
      expect(r.candidates).toHaveLength(2);
      expect(r.candidates[0]).toMatchObject({ parent: '客户', child: '项目', disposition: 'autofill' });
      expect(r.candidates[1].disposition).toBe('ask');
      expect(r.candidates[1].questions).toHaveLength(1);
      const saved = prisma.project.update.mock.calls[0][0].data.structuredRequirement;
      expect(saved.relationCandidates).toHaveLength(2);
      expect(saved.designSuggestions).toBeDefined(); // 原 sr 保留
    });

    it('模型给非法 JSON → 候选空，不崩，仍存', async () => {
      deepseek.chat.mockResolvedValue('抱歉无法分析');
      const r = await svc.detect('u1', null, 'p1');
      expect(r.candidates).toEqual([]);
      expect(prisma.project.update).toHaveBeenCalled();
    });

    it('过滤缺 parent/child 的脏项；非法 cardinality 降级 1-N', async () => {
      deepseek.chat.mockResolvedValue('[{"parent":"客户","child":"项目","cardinality":"乱","disposition":"autofill"},{"child":"x"},{"parent":"y"}]');
      const r = await svc.detect('u1', null, 'p1');
      expect(r.candidates).toHaveLength(1);
      expect(r.candidates[0].cardinality).toBe('1-N');
    });

    it('树：显式 tree=true 或 parent===child 都判为树，cardinality 归一 1-N', async () => {
      deepseek.chat.mockResolvedValue(
        JSON.stringify([
          { parent: '部门', child: '部门', cardinality: '1-N', tree: true, fkField: 'parentId', disposition: 'autofill' },
          { parent: '分类', child: '分类', cardinality: 'N-N', fkField: 'parentId', disposition: 'autofill' }, // 无 tree 标记但同实体
        ]),
      );
      const r = await svc.detect('u1', null, 'p1');
      expect(r.candidates[0]).toMatchObject({ tree: true, fkField: 'parentId', cardinality: '1-N' });
      expect(r.candidates[1]).toMatchObject({ parent: '分类', tree: true, cardinality: '1-N' }); // N-N 被树覆盖归 1-N
    });

    it('N-N：保留 cardinality 与 joinTable', async () => {
      deepseek.chat.mockResolvedValue(
        JSON.stringify([{ parent: '学生', child: '课程', cardinality: 'N-N', joinTable: 'student_course', disposition: 'ask' }]),
      );
      const r = await svc.detect('u1', null, 'p1');
      expect(r.candidates[0]).toMatchObject({ cardinality: 'N-N', joinTable: 'student_course', tree: undefined });
    });

    it('ownership：非属主拒绝', async () => {
      await expect(svc.detect('other', null, 'p1')).rejects.toThrow(ForbiddenException);
      expect(deepseek.chat).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    const withCandidates = (cands: any[]) =>
      prisma.project.findUnique.mockResolvedValue({
        ...project,
        structuredRequirement: { ...project.structuredRequirement, relationCandidates: cands },
      });

    it('autofill 候选直接成关系（默认 required/restrict）', async () => {
      withCandidates([{ parent: '客户', child: '项目', cardinality: '1-N', fkField: 'customerId', source: 'page', disposition: 'autofill' }]);
      const r = await svc.apply('u1', null, 'p1');
      expect(r.relations).toHaveLength(1);
      expect(r.relations[0]).toMatchObject({ parent: '客户', child: '项目', cardinality: '1-N', required: true, onDelete: 'restrict', confirmed: true });
      expect(prisma.project.update.mock.calls[0][0].data.structuredRequirement.relations).toHaveLength(1);
    });

    it('ask 候选按 answers 定案（基数 + 级联）', async () => {
      withCandidates([{ parent: '客户', child: '工单', cardinality: '1-N', disposition: 'ask' }]);
      const r = await svc.apply('u1', null, 'p1', { '客户->工单': { cardinality: '1-N', onDelete: 'cascade' } });
      expect(r.relations[0]).toMatchObject({ child: '工单', cardinality: '1-N', onDelete: 'cascade' });
    });

    it('ask 答"没关系"(none) → 丢弃，不回写', async () => {
      withCandidates([{ parent: '客户', child: '日志', cardinality: '1-N', disposition: 'ask' }]);
      const r = await svc.apply('u1', null, 'p1', { '客户->日志': { cardinality: 'none' } });
      expect(r.relations).toHaveLength(0);
    });

    it('ask 无答案 → 不偷偷按默认值落库，留给追加问答', async () => {
      withCandidates([{ parent: '客户', child: '工单', cardinality: '1-N', disposition: 'ask' }]);
      const r = await svc.apply('u1', null, 'p1'); // 不传 answers
      expect(r.relations).toEqual([]);
    });

    it('非法 onDelete 答案 → 兜底 restrict', async () => {
      withCandidates([{ parent: '客户', child: '项目', cardinality: '1-N', disposition: 'autofill' }]);
      const r = await svc.apply('u1', null, 'p1', { '客户->项目': { onDelete: 'bogus' } });
      expect(r.relations[0].onDelete).toBe('restrict');
    });

    it('树候选 → 回写带 tree=true、自外键', async () => {
      withCandidates([{ parent: '部门', child: '部门', cardinality: '1-N', tree: true, fkField: 'parentId', disposition: 'autofill' }]);
      const r = await svc.apply('u1', null, 'p1');
      expect(r.relations[0]).toMatchObject({ parent: '部门', child: '部门', tree: true, fkField: 'parentId', cardinality: '1-N' });
    });

    it('N-N 候选 → 回写保留（不丢弃），带 joinTable', async () => {
      withCandidates([{ parent: '学生', child: '课程', cardinality: 'N-N', joinTable: 'student_course', disposition: 'autofill' }]);
      const r = await svc.apply('u1', null, 'p1');
      expect(r.relations).toHaveLength(1);
      expect(r.relations[0]).toMatchObject({ cardinality: 'N-N', joinTable: 'student_course' });
    });
  });

  it('get 返回候选 + 关系，不调模型', async () => {
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      structuredRequirement: { relationCandidates: [{ parent: '客户', child: '项目' }], relations: [{ parent: '客户', child: '项目', confirmed: true }] },
    });
    const r = await svc.get('u1', null, 'p1');
    expect(r.candidates).toHaveLength(1);
    expect(r.relations).toHaveLength(1);
    expect(deepseek.chat).not.toHaveBeenCalled();
  });
});
