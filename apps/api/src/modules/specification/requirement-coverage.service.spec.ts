import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { RequirementCoverageService } from './requirement-coverage.service';

function make(overrides: { project?: any } = {}) {
  const project = 'project' in overrides ? overrides.project : { userId: 'u1', dataModel: '', structuredRequirement: {}, planSummary: {} };
  const prisma = { project: { findUnique: jest.fn(async () => project) } };
  const schema = { parseAndValidate: jest.fn(() => [{ name: 'A', table: 'a', fields: [] }]) };
  const assembler = { assemble: jest.fn(() => ({ entities: [], relations: [], roles: [], menus: [] })) };
  const coverage = { evaluate: jest.fn(() => ({ coverage: 42, perSlot: { entities: 'missing' }, gaps: ['缺业务对象'] })) };
  const followup = { getQuestions: jest.fn(async () => ({ questions: [{ id: 'q1' }] })) };
  const svc = new RequirementCoverageService(prisma as any, schema as any, assembler as any, coverage as any, followup as any);
  return { svc, prisma, schema, assembler, coverage, followup };
}

describe('RequirementCoverageService', () => {
  it('项目不存在 → NotFound', async () => {
    const { svc } = make({ project: null });
    await expect(svc.getCoverage('u1', null, 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('非属主 → Forbidden', async () => {
    const { svc } = make({ project: { userId: 'other', dataModel: '', structuredRequirement: {}, planSummary: {} } });
    await expect(svc.getCoverage('u1', null, 'p1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('dataModel 空 → 不解析，按空实体组装，聚合覆盖度+选择题', async () => {
    const { svc, schema, assembler, coverage } = make();
    const r = await svc.getCoverage('u1', null, 'p1');
    expect(schema.parseAndValidate).not.toHaveBeenCalled();
    expect(assembler.assemble).toHaveBeenCalledWith([], {}, {});
    expect(coverage.evaluate).toHaveBeenCalled();
    expect(r).toEqual({ coverage: 42, perSlot: { entities: 'missing' }, gaps: ['缺业务对象'], questions: [{ id: 'q1' }] });
  });

  it('有 dataModel → 解析实体后组装', async () => {
    const { svc, schema, assembler } = make({ project: { userId: 'u1', dataModel: 'model A {}', structuredRequirement: {}, planSummary: {} } });
    await svc.getCoverage('u1', null, 'p1');
    expect(schema.parseAndValidate).toHaveBeenCalledWith('model A {}');
    expect(assembler.assemble).toHaveBeenCalledWith([{ name: 'A', table: 'a', fields: [] }], {}, {});
  });

  it('dataModel 解析失败 → 按空实体，不抛', async () => {
    const { svc, schema, assembler } = make({ project: { userId: 'u1', dataModel: 'bad', structuredRequirement: {}, planSummary: {} } });
    schema.parseAndValidate.mockImplementation(() => { throw new Error('parse fail'); });
    const r = await svc.getCoverage('u1', null, 'p1');
    expect(assembler.assemble).toHaveBeenCalledWith([], {}, {});
    expect(r.coverage).toBe(42);
  });

  it('followup 取题失败 → questions=[]，不阻断', async () => {
    const { svc, followup } = make();
    followup.getQuestions.mockRejectedValueOnce?.(new Error('boom'));
    followup.getQuestions.mockImplementation(async () => { throw new Error('boom'); });
    const r = await svc.getCoverage('u1', null, 'p1');
    expect(r.questions).toEqual([]);
    expect(r.coverage).toBe(42);
  });

  it('acceptanceScenarios 取自 planSummary 优先、退 structuredRequirement', async () => {
    const { svc, coverage } = make({ project: { userId: 'u1', dataModel: '', structuredRequirement: { acceptanceScenarios: [{ name: 'sr' }] }, planSummary: { acceptanceScenarios: [{ name: 'plan' }] } } });
    await svc.getCoverage('u1', null, 'p1');
    expect(coverage.evaluate).toHaveBeenCalledWith(expect.anything(), [{ name: 'plan' }]);
  });
});
