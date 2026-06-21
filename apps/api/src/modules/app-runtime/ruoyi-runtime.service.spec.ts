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

  it('编排顺序：建表→部署(全表一次)→seed角色，返回 ready descriptor', async () => {
    const order: string[] = [];
    const client = {
      seedRoles: jest.fn(async () => { order.push('seed'); return { created: 1, skipped: 0 }; }),
    };
    const infra = {
      applyDdl: jest.fn(async (s: string[]) => { order.push(`ddl:${s.length}`); }),
      deployTables: jest.fn(async (_c: unknown, t: string[]) => { order.push(`deploy:${t.join(',')}`); }),
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
    expect(infra.deployTables.mock.calls[0][1]).toEqual(['student', 'course', 'student_course']);
    // 顺序：ddl → deploy → seed
    expect(order).toEqual(['ddl:3', 'deploy:student,course,student_course', 'seed']);
    // 角色映射：中文名取不出 ascii → app_role_N；dataScope 透传
    expect((client.seedRoles as jest.Mock).mock.calls[0][1]).toEqual([
      { roleName: '管理员', roleKey: 'app_role_1', dataScope: '1' },
      { roleName: '店员', roleKey: 'app_role_2', dataScope: '5' },
    ]);
    expect(res.descriptor).toMatchObject({ kind: 'ruoyi', status: 'ready', resources: expect.arrayContaining(['student_course']) });
  });

  it('无角色 → 跳过 seed（不报错）', async () => {
    const client = { seedRoles: jest.fn() };
    const infra = { applyDdl: jest.fn(async () => {}), deployTables: jest.fn(async () => {}) };
    const rt = new RuoyiRuntime(client as never);
    await rt.provisionApp('p1', { entities: [student], roles: [], menus: [] }, cfg as never, infra as never);
    expect(client.seedRoles).not.toHaveBeenCalled();
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
