import { RuoyiRuntime } from './ruoyi-runtime.service';
import { AppSpec } from './app-spec.types';
import { ModelField, ParsedModel } from './data-model.types';

const field = (name: string, over: Partial<ModelField> = {}): ModelField => ({
  name,
  prismaType: 'String',
  optional: false,
  isId: false,
  isUnique: false,
  ...over,
});

const dept: ParsedModel = { name: 'Dept', table: 'dept', fields: [field('id', { isId: true, prismaType: 'BigInt' }), field('deptName')] };
const student: ParsedModel = { name: 'Student', table: 'student', fields: [field('id', { isId: true }), field('name')] };
const course: ParsedModel = { name: 'Course', table: 'course', fields: [field('id', { isId: true }), field('title')] };

describe('RuoyiRuntime · provisionApp 串完整链', () => {
  const cfg = { baseUrl: 'http://x', clientId: 'c', username: 'admin', password: 'p', tenantId: '000000' };

  it('编排顺序：建表→部署→探活→seed角色，返回 ready descriptor', async () => {
    const order: string[] = [];
    const client = {
      seedRoles: jest.fn(async () => { order.push('seed'); return { created: 1, skipped: 0 }; }),
      seedMenusAndGrant: jest.fn(async () => { order.push('grant'); return { menusCreated: 5, rolesGranted: 2 }; }),
    };
    const infra = {
      applyDdl: jest.fn(async (s: string[]) => { order.push(`ddl:${s.length}`); }),
      deploySources: jest.fn(async (_c: unknown, t: string[]) => { order.push(`deploy:${t.join(',')}`); }),
      waitReady: jest.fn(async () => { order.push('ready'); }),
    };
    const rt = new RuoyiRuntime(client as never);
    const spec: AppSpec = {
      entities: [student, course],
      roles: [{ name: '管理员', dataScope: '1' }, { name: '店员', dataScope: '5' }],
      menus: [],
      relations: [{ parent: 'student', child: 'course', cardinality: 'N-N', joinTable: 'student_course' }],
    };
    const res = await rt.provisionApp('p1', spec, cfg as never, infra as never);

    // 建表含 N—N 中间表（3 张：student/course/student_course）
    expect(infra.applyDdl).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('student_course')]));
    expect(infra.applyDdl.mock.calls[0][0]).toHaveLength(3);
    // 部署一次性传全部表（含中间表）
    expect(infra.deploySources.mock.calls[0][1]).toEqual(['student', 'course', 'student_course']);
    // 顺序：ddl → deploy → 探活 → seed角色 → 种权限点并绑角色
    expect(order).toEqual(['ddl:3', 'deploy:student,course,student_course', 'ready', 'seed', 'grant']);
    // 权限点种子按表名+角色 key 绑（解生成接口 403）
    expect((client.seedMenusAndGrant as jest.Mock).mock.calls[0]).toEqual([cfg, ['student', 'course', 'student_course'], ['app_role_1', 'app_role_2']]);
    // 角色映射：中文名取不出 ascii → app_role_N；dataScope 透传
    expect((client.seedRoles as jest.Mock).mock.calls[0][1]).toEqual([
      { roleName: '管理员', roleKey: 'app_role_1', dataScope: '1' },
      { roleName: '店员', roleKey: 'app_role_2', dataScope: '5' },
    ]);
    expect(res.descriptor).toMatchObject({ kind: 'ruoyi', status: 'ready', resources: expect.arrayContaining(['student_course']) });
  });

  it('无角色 → 跳过 seed（不报错）', async () => {
    const client = { seedRoles: jest.fn() };
    const infra = { applyDdl: jest.fn(async () => {}), deploySources: jest.fn(async () => {}), waitReady: jest.fn(async () => {}) };
    const rt = new RuoyiRuntime(client as never);
    await rt.provisionApp('p1', { entities: [student], roles: [], menus: [] }, cfg as never, infra as never);
    expect(client.seedRoles).not.toHaveBeenCalled();
  });

  it('断点续跑：相位=deployed → 跳过建表/部署（不重编译），只补探活+seed，相位推进', async () => {
    const saved: string[] = [];
    const client = { seedRoles: jest.fn(async () => ({ created: 1, skipped: 0 })), seedMenusAndGrant: jest.fn(async () => ({ menusCreated: 5, rolesGranted: 1 })) };
    const infra = {
      applyDdl: jest.fn(async () => {}),
      deploySources: jest.fn(async () => {}),
      waitReady: jest.fn(async () => {}),
    };
    const checkpoint = { load: jest.fn(async () => 'deployed' as const), save: jest.fn(async (p: string) => { saved.push(p); }) };
    const rt = new RuoyiRuntime(client as never);
    const spec: AppSpec = { entities: [student], roles: [{ name: '管理员', dataScope: '1' }], menus: [] };
    await rt.provisionApp('p1', spec, cfg as never, infra as never, checkpoint as never);

    expect(infra.applyDdl).not.toHaveBeenCalled();    // 'ddl' 已越过
    expect(infra.deploySources).not.toHaveBeenCalled(); // 'deployed' 已越过——不重编译
    expect(infra.waitReady).toHaveBeenCalledTimes(1);   // 'ready' 待补
    expect(client.seedRoles).toHaveBeenCalledTimes(1);  // 'seeded' 待补
    expect(saved).toEqual(['ready', 'seeded']);
  });

  it('断点续跑：相位=none（首跑）→ 全步执行并逐相位 save', async () => {
    const saved: string[] = [];
    const client = { seedRoles: jest.fn(async () => ({ created: 1, skipped: 0 })), seedMenusAndGrant: jest.fn(async () => ({ menusCreated: 5, rolesGranted: 1 })) };
    const infra = { applyDdl: jest.fn(async () => {}), deploySources: jest.fn(async () => {}), waitReady: jest.fn(async () => {}) };
    const checkpoint = { load: jest.fn(async () => 'none' as const), save: jest.fn(async (p: string) => { saved.push(p); }) };
    const rt = new RuoyiRuntime(client as never);
    await rt.provisionApp('p1', { entities: [student], roles: [{ name: 'a', dataScope: '1' }], menus: [] }, cfg as never, infra as never, checkpoint as never);
    expect(saved).toEqual(['ddl', 'deployed', 'ready', 'seeded']);
  });
});

describe('RuoyiRuntime · 关系增强组合（树 + N—N 接进 codegen 出口）', () => {
  const rt = new RuoyiRuntime({} as never); // 纯 codegen 方法不碰 client

  it('树：tplCategory=tree 经 genTableMetas 透出，且 dept 表带自外键 parentId', () => {
    const spec: AppSpec = { entities: [dept], roles: [], menus: [], relations: [{ parent: 'dept', child: 'dept', cardinality: '1-N', tree: true, fkField: 'parentId' }] };
    const metas = rt.genTableMetas(spec);
    expect(metas.find((m) => m.table === 'dept')).toMatchObject({ tplCategory: 'tree', treeParentCode: 'parentId' });
    const ddl = rt.ddlFor(spec).join('\n');
    expect(ddl).toContain('`parentId`');
  });

  it('N—N：合成中间表进 gen_table 与 DDL（双向可查），两端表保持 crud', () => {
    const spec: AppSpec = { entities: [student, course], roles: [], menus: [], relations: [{ parent: 'student', child: 'course', cardinality: 'N-N', joinTable: 'student_course' }] };
    const tables = rt.buildGenTables(spec).map((t) => t.tableName);
    expect(tables).toContain('student_course');
    const ddl = rt.ddlFor(spec).join('\n');
    expect(ddl).toContain('create table if not exists `student_course`');
    expect(ddl).toContain('`studentId`');
    expect(ddl).toContain('`courseId`');
    const metas = rt.genTableMetas(spec);
    expect(metas.find((m) => m.table === 'student_course')!.tplCategory).toBe('crud');
    expect(metas.find((m) => m.table === 'student')!.tplCategory).toBe('crud');
  });
});
