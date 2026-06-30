import { evaluateSpecificationGate } from './specification-gate';

describe('evaluateSpecificationGate', () => {
  const completeSpec = {
    version: 3,
    status: 'frozen',
    frozenAt: new Date('2026-06-30T10:00:00.000Z'),
    roles: [{ name: '管理员', permissions: ['view'] }],
    coreFunctions: [{ name: '合同管理', description: '维护合同台账' }],
    dataModels: [{ name: '合同', fields: [{ name: 'id', type: 'string', required: true }] }],
    businessRules: [{ name: '超期预警', trigger: '到期前', outcome: '推送预警' }],
    acceptanceScenarios: [{ name: '新增合同', given: '已登录', when: '提交合同', then: '合同入库' }],
    pages: [{ name: '合同台账', route: '/contracts' }],
  };

  it('fails when specification does not exist', () => {
    const gate = evaluateSpecificationGate(null);

    expect(gate.readyToFreeze).toBe(false);
    expect(gate.deliveryStatus).toBe('fail');
    expect(gate.requiredGaps).toContain('角色为空');
    expect(gate.freezeMessage).toContain('尚未生成规格');
  });

  it('fails incomplete frozen specifications instead of trusting status only', () => {
    const gate = evaluateSpecificationGate({
      ...completeSpec,
      coreFunctions: [],
      businessRules: [],
    });

    expect(gate.frozen).toBe(true);
    expect(gate.readyToFreeze).toBe(false);
    expect(gate.deliveryStatus).toBe('fail');
    expect(gate.requiredGaps).toEqual(['核心功能为空', '业务规则为空']);
    expect(gate.deliverySummary).toContain('规格内容不完整');
  });

  it('blocks delivery while a complete specification is still draft', () => {
    const gate = evaluateSpecificationGate({ ...completeSpec, status: 'draft', frozenAt: null });

    expect(gate.readyToFreeze).toBe(true);
    expect(gate.contentStatus).toBe('pass');
    expect(gate.deliveryStatus).toBe('fail');
    expect(gate.deliverySummary).toContain('尚未冻结确认');
  });

  it('passes frozen complete specifications', () => {
    const gate = evaluateSpecificationGate(completeSpec);

    expect(gate.readyToFreeze).toBe(true);
    expect(gate.contentStatus).toBe('pass');
    expect(gate.deliveryStatus).toBe('pass');
    expect(gate.counts.dataModels).toBe(1);
  });

  it('keeps missing pages as an advisory gap, not a hard freeze blocker', () => {
    const gate = evaluateSpecificationGate({ ...completeSpec, pages: [] });

    expect(gate.readyToFreeze).toBe(true);
    expect(gate.contentStatus).toBe('warn');
    expect(gate.deliveryStatus).toBe('warn');
    expect(gate.advisoryGaps).toEqual(['页面清单为空']);
  });
});
