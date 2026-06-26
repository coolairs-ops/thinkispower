import { AppSpecAssemblerService, deriveDataScope, cleanRoleName } from './app-spec-assembler.service';
import { ParsedModel } from './data-model.types';

const entities: ParsedModel[] = [
  { name: 'Customer', table: 'customer', fields: [{ name: 'id', prismaType: 'BigInt', optional: false, isId: true, isUnique: false }] },
  { name: 'Order', table: 'order', fields: [{ name: 'id', prismaType: 'BigInt', optional: false, isId: true, isUnique: false }] },
];

describe('AppSpecAssemblerService.assemble（IR → AppSpec 适配器①）', () => {
  const svc = new AppSpecAssemblerService({} as never, {} as never);

  it('relations：Relation → AppRelation 直接映射，丢弃 none', () => {
    const sr = {
      relations: [
        { parent: '客户', child: '订单', cardinality: '1-N', fkField: 'customerId', required: true, onDelete: 'restrict', confirmed: true },
        { parent: '部门', child: '部门', cardinality: '1-N', tree: true, fkField: 'parentId' },
        { parent: '学生', child: '课程', cardinality: 'N-N', joinTable: 'student_course' },
        { parent: 'x', child: 'y', cardinality: 'none' }, // 丢弃
        { child: '缺parent' }, // 丢弃
      ],
    };
    const spec = svc.assemble(entities, sr, {});
    expect(spec.relations).toHaveLength(3);
    expect(spec.relations![0]).toEqual({ parent: '客户', child: '订单', cardinality: '1-N', fkField: 'customerId', tree: undefined, joinTable: undefined, required: true, onDelete: 'restrict' });
    expect(spec.relations![1]).toMatchObject({ tree: true, fkField: 'parentId' });
    expect(spec.relations![2]).toMatchObject({ cardinality: 'N-N', joinTable: 'student_course' });
  });

  it('roles：planSummary.roles 优先；字符串/对象都吃；dataScope 按名推', () => {
    const plan = { roles: [{ name: '系统管理员' }, '普通员工', { name: '本部门主管' }] };
    const spec = svc.assemble(entities, {}, plan);
    expect(spec.roles).toEqual([
      { name: '系统管理员', dataScope: '1' },
      { name: '普通员工', dataScope: '5' },
      { name: '本部门主管', dataScope: '3' },
    ]);
  });

  it('roles：planSummary 无则退 sr.roles', () => {
    const spec = svc.assemble(entities, { roles: [{ name: '审计员' }] }, {});
    expect(spec.roles).toEqual([{ name: '审计员', dataScope: '1' }]);
  });

  it('roles：整句描述的角色名清洗成短名，dataScope 仍按全名关键词推', () => {
    const plan = { roles: [{ name: '管理员：查看所有客户和项目数据、管理用户权限。' }, { name: '普通用户（业务员）：仅看自己的数据。' }] };
    const spec = svc.assemble(entities, {}, plan);
    expect(spec.roles).toEqual([
      { name: '管理员', dataScope: '1' },
      { name: '普通用户', dataScope: '5' },
    ]);
  });

  it('menus：page {name,route} → menu，名字含实体名才 best-effort 关联（中文名匹配不到则留空）', () => {
    const plan = { pages: [{ name: 'order列表', route: '/order' }, { name: '客户管理' }, { name: '统计看板' }] };
    const spec = svc.assemble(entities, {}, plan);
    expect(spec.menus[0]).toEqual({ name: 'order列表', path: '/order', entity: 'order' }); // 含 "order" → 关联
    expect(spec.menus[1]).toMatchObject({ name: '客户管理', path: '/客户管理', entity: undefined }); // 中文，匹配不到英文实体名
    expect(spec.menus[2]).toMatchObject({ name: '统计看板', entity: undefined });
  });

  it('entities 带入；过滤与若依内置冲突的表(user/role/menu…)', () => {
    const withUser = [...entities, { name: 'User', table: 'user', fields: [{ name: 'id', prismaType: 'BigInt', optional: false, isId: true, isUnique: false }] }];
    const spec = svc.assemble(withUser, {}, {});
    expect(spec.entities.map((e) => e.table)).toEqual(['customer', 'order']); // user 被滤掉
    expect(spec.relations).toEqual([]);
  });
});

describe('deriveDataScope（角色名 → 数据权限）', () => {
  it.each([
    ['系统管理员', '1'],
    ['超级管理员', '1'],
    ['部门经理', '3'], // 含"部门"→本部门数据（先于"经理"命中，合理）
    ['仅本人', '5'],
    ['普通员工', '5'],
    ['个人中心用户', '5'],
    ['本部门及以下', '4'],
    ['本部门', '3'],
    ['未知角色', '1'],
  ])('%s → %s', (name, scope) => {
    expect(deriveDataScope(name)).toBe(scope);
  });
});

describe('cleanRoleName', () => {
  it.each([
    ['管理员：查看所有数据', '管理员'],
    ['普通用户（业务员）：仅本人', '普通用户'],
    ['销售管理员 — 查看所有门店与任务、规划任务', '销售管理员'], // planSummary 破折号描述 → 剥短名(本次修复)
    ['审计员', '审计员'],
    ['x'.repeat(40), 'x'.repeat(18)],
  ])('%s → 短名', (full, expected) => {
    expect(cleanRoleName(full)).toBe(expected);
  });
});
