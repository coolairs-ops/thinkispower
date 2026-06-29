import { RuoyiCoverageService, AcceptanceScenarioLite } from './ruoyi-coverage.service';
import { AppSpec } from './app-spec.types';
import { ParsedModel } from './data-model.types';

/** 造一个带业务字段的实体（id + 若干业务列）。 */
function entity(name: string, businessFields: string[] = ['title']): ParsedModel {
  return {
    name,
    table: name.toLowerCase(),
    fields: [
      { name: 'id', prismaType: 'BigInt', optional: false, isId: true, isUnique: true },
      ...businessFields.map((f) => ({ name: f, prismaType: 'String', optional: true, isId: false, isUnique: false })),
    ],
  };
}

/** 只有 id（无业务字段）的裸实体。 */
function bareEntity(name: string): ParsedModel {
  return { name, table: name.toLowerCase(), fields: [{ name: 'id', prismaType: 'BigInt', optional: false, isId: true, isUnique: true }] };
}

const FULL_SCENARIO: AcceptanceScenarioLite = { name: '新增客户', given: '已登录', when: '提交客户表单', then: '列表出现该客户', priority: 'must' };

/** 完整 spec：七槽全 known。 */
function fullSpec(): AppSpec {
  return {
    entities: [entity('Customer', ['name', 'phone']), entity('Contract', ['amount', 'term'])],
    relations: [{ parent: 'Customer', child: 'Contract', cardinality: '1-N', fkField: 'customerId' }],
    roles: [{ name: '管理员', dataScope: '1' }, { name: '普通员工', dataScope: '5' }],
    menus: [{ name: '客户管理', path: '/customer', entity: 'customer' }],
  };
}

describe('RuoyiCoverageService', () => {
  const svc = new RuoyiCoverageService();

  it('空 spec → coverage 极低，关键槽 missing', () => {
    const r = svc.evaluate({ entities: [], relations: [], roles: [], menus: [] }, []);
    expect(r.perSlot.entities).toBe('missing');
    expect(r.perSlot.fields).toBe('missing');
    expect(r.perSlot.roles).toBe('missing');
    expect(r.perSlot.menus).toBe('missing');
    expect(r.perSlot.acceptanceScenarios).toBe('missing');
    expect(r.perSlot.dataScope).toBe('missing');
    expect(r.perSlot.relations).toBe('missing'); // 0 实体 → 空 spec，不给关系白送分
    expect(r.coverage).toBe(0);
    expect(r.gaps).toContain('业务对象（要管理哪些数据，如客户/合同/设备）');
  });

  it('完整 spec → 七槽全 known，coverage 100', () => {
    const r = svc.evaluate(fullSpec(), [FULL_SCENARIO]);
    expect(Object.values(r.perSlot).every((s) => s === 'known')).toBe(true);
    expect(r.coverage).toBe(100);
    expect(r.gaps).toEqual([]);
  });

  it('无验收场景 → 验收 missing + 缺口提示', () => {
    const r = svc.evaluate(fullSpec(), []);
    expect(r.perSlot.acceptanceScenarios).toBe('missing');
    expect(r.coverage).toBe(90); // 100 - 验收 10
    expect(r.gaps.some((g) => g.includes('验收场景'))).toBe(true);
  });

  it('角色无数据范围区分（全默认全部）→ dataScope partial', () => {
    const spec = fullSpec();
    spec.roles = [{ name: '管理员', dataScope: '1' }, { name: '主管', dataScope: '1' }];
    const r = svc.evaluate(spec, [FULL_SCENARIO]);
    expect(r.perSlot.roles).toBe('known'); // 有角色
    expect(r.perSlot.dataScope).toBe('partial'); // 但没区分谁看哪些数据
    expect(r.coverage).toBe(95); // 100 - dataScope 半扣 5
    expect(r.gaps.some((g) => g.includes('数据权限范围'))).toBe(true);
  });

  it('部分实体裸（无业务字段）→ fields partial', () => {
    const spec = fullSpec();
    spec.entities = [entity('Customer', ['name']), bareEntity('Contract')];
    const r = svc.evaluate(spec, [FULL_SCENARIO]);
    expect(r.perSlot.fields).toBe('partial');
    expect(r.gaps.some((g) => g.includes('字段'))).toBe(true);
  });

  it('所有实体裸 → fields missing', () => {
    const spec = fullSpec();
    spec.entities = [bareEntity('Customer'), bareEntity('Contract')];
    const r = svc.evaluate(spec, [FULL_SCENARIO]);
    expect(r.perSlot.fields).toBe('missing');
  });

  it('多实体但无关系 → relations missing', () => {
    const spec = fullSpec();
    spec.relations = [];
    const r = svc.evaluate(spec, [FULL_SCENARIO]);
    expect(r.perSlot.relations).toBe('missing');
    expect(r.gaps.some((g) => g.includes('关系'))).toBe(true);
  });

  it('单实体无关系 → relations known（不扣分）', () => {
    const spec: AppSpec = { entities: [entity('Note', ['body'])], relations: [], roles: [{ name: '管理员', dataScope: '1' }], menus: [{ name: '笔记', path: '/note' }] };
    const r = svc.evaluate(spec, [FULL_SCENARIO]);
    expect(r.perSlot.relations).toBe('known');
  });

  it('验收场景缺三段（只有 name）→ acceptance partial', () => {
    const r = svc.evaluate(fullSpec(), [{ name: '随便写的' }]);
    expect(r.perSlot.acceptanceScenarios).toBe('partial');
    expect(r.gaps.some((g) => g.includes('不完整'))).toBe(true);
  });

  it('coverage 单调：更全的 spec 分更高', () => {
    const low = svc.evaluate({ entities: [bareEntity('A')], relations: [], roles: [], menus: [] }, []).coverage;
    const mid = svc.evaluate({ entities: [entity('A', ['x'])], relations: [], roles: [{ name: '管理员', dataScope: '1' }], menus: [] }, []).coverage;
    const high = svc.evaluate(fullSpec(), [FULL_SCENARIO]).coverage;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });
});
