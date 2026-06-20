import { ensureFkColumns, genTableMeta, synthesizeJoinEntities } from './ruoyi-relations';
import { ParsedModel, ModelField } from './data-model.types';
import { AppRelation } from './app-spec.types';

const field = (name: string, over: Partial<ModelField> = {}): ModelField => ({
  name,
  prismaType: 'String',
  optional: false,
  isId: false,
  isUnique: false,
  ...over,
});

const store: ParsedModel = { name: 'Store', table: 'store', fields: [field('id', { isId: true }), field('name')] };
const task: ParsedModel = { name: 'Task', table: 'task', fields: [field('id', { isId: true }), field('title')] };
const inspect: ParsedModel = { name: 'Inspect', table: 'inspect', fields: [field('id', { isId: true }), field('storeId', { prismaType: 'BigInt' })] };
const dept: ParsedModel = { name: 'Dept', table: 'dept', fields: [field('id', { isId: true, prismaType: 'BigInt' }), field('deptName')] };
const student: ParsedModel = { name: 'Student', table: 'student', fields: [field('id', { isId: true }), field('name')] };
const course: ParsedModel = { name: 'Course', table: 'course', fields: [field('id', { isId: true }), field('title')] };

describe('ruoyi-relations（关系 → 若依子表 codegen 输入 · Phase 2a）', () => {
  describe('ensureFkColumns', () => {
    it('child 缺外键列 → 补 BigInt 外键', () => {
      const rels: AppRelation[] = [{ parent: 'store', child: 'task', cardinality: '1-N', fkField: 'storeId' }];
      const out = ensureFkColumns([store, task], rels);
      const t = out.find((e) => e.table === 'task')!;
      expect(t.fields.some((f) => f.name === 'storeId' && f.prismaType === 'BigInt')).toBe(true);
      // 不改原数组
      expect(task.fields.some((f) => f.name === 'storeId')).toBe(false);
    });

    it('child 已有外键 → 不重复加', () => {
      const rels: AppRelation[] = [{ parent: 'store', child: 'inspect', cardinality: '1-N', fkField: 'storeId' }];
      const out = ensureFkColumns([store, inspect], rels);
      const i = out.find((e) => e.table === 'inspect')!;
      expect(i.fields.filter((f) => f.name === 'storeId')).toHaveLength(1);
    });

    it('required=false → 外键可空；非 1-N / 无 fkField 跳过', () => {
      const out = ensureFkColumns([store, task], [
        { parent: 'store', child: 'task', cardinality: '1-N', fkField: 'storeId', required: false },
      ]);
      expect(out.find((e) => e.table === 'task')!.fields.find((f) => f.name === 'storeId')!.optional).toBe(true);
      // N-N 不处理
      const out2 = ensureFkColumns([store, task], [{ parent: 'store', child: 'task', cardinality: 'N-N', fkField: 'x' }]);
      expect(out2.find((e) => e.table === 'task')!.fields.some((f) => f.name === 'x')).toBe(false);
    });

    it('按实体 name 或 table 匹配（忽略大小写）', () => {
      const out = ensureFkColumns([store, task], [{ parent: 'Store', child: 'Task', cardinality: '1-N', fkField: 'storeId' }]);
      expect(out.find((e) => e.table === 'task')!.fields.some((f) => f.name === 'storeId')).toBe(true);
    });
  });

  describe('genTableMeta', () => {
    const rels: AppRelation[] = [{ parent: 'store', child: 'task', cardinality: '1-N', fkField: 'storeId' }];

    it('父表 → sub（带 subTableName/subTableFkName）', () => {
      expect(genTableMeta(store, [store, task], rels)).toEqual({ tplCategory: 'sub', subTableName: 'task', subTableFkName: 'storeId' });
    });

    it('子表/无关系实体 → crud', () => {
      expect(genTableMeta(task, [store, task], rels)).toEqual({ tplCategory: 'crud' });
      expect(genTableMeta(store, [store, task], [])).toEqual({ tplCategory: 'crud' });
    });

    it('一父多子 → 取第一条作子表（其余仍 crud，外键已在）', () => {
      const multi: AppRelation[] = [
        { parent: 'store', child: 'task', cardinality: '1-N', fkField: 'storeId' },
        { parent: 'store', child: 'inspect', cardinality: '1-N', fkField: 'storeId' },
      ];
      expect(genTableMeta(store, [store, task, inspect], multi).subTableName).toBe('task');
    });
  });

  describe('树（自关联 · Phase 2c）', () => {
    const treeRel: AppRelation[] = [{ parent: 'dept', child: 'dept', cardinality: '1-N', tree: true, fkField: 'parentId' }];

    it('ensureFkColumns：树补自外键 parentId，且强制可空（根无上级）', () => {
      const out = ensureFkColumns([dept], treeRel);
      const d = out.find((e) => e.table === 'dept')!;
      const pid = d.fields.find((f) => f.name === 'parentId')!;
      expect(pid).toMatchObject({ prismaType: 'BigInt', optional: true });
    });

    it('genTableMeta：树 → tree 模板（treeCode=pk / treeParentCode=自外键 / treeName=显示名列）', () => {
      const out = ensureFkColumns([dept], treeRel);
      expect(genTableMeta(out[0], out, treeRel)).toEqual({
        tplCategory: 'tree',
        treeCode: 'id',
        treeParentCode: 'parentId',
        treeName: 'deptName',
      });
    });

    it('parent===child 即判树（无显式 tree 标记也算）', () => {
      const rel: AppRelation[] = [{ parent: 'dept', child: 'dept', cardinality: '1-N', fkField: 'parentId' }];
      const out = ensureFkColumns([dept], rel);
      expect(genTableMeta(out[0], out, rel).tplCategory).toBe('tree');
    });

    it('树不被误判为主子表 sub（树优先于 sub）', () => {
      const out = ensureFkColumns([dept], treeRel);
      expect(genTableMeta(out[0], out, treeRel).subTableName).toBeUndefined();
    });
  });

  describe('N—N 中间表（Phase 2b）', () => {
    const nn: AppRelation[] = [{ parent: 'student', child: 'course', cardinality: 'N-N', joinTable: 'student_course' }];

    it('synthesizeJoinEntities：N—N → 中间表实体（自增主键 + 两端外键）', () => {
      const joins = synthesizeJoinEntities([student, course], nn);
      expect(joins).toHaveLength(1);
      const j = joins[0];
      expect(j.table).toBe('student_course');
      expect(j.fields.find((f) => f.isId)).toMatchObject({ name: 'id', prismaType: 'BigInt' });
      expect(j.fields.map((f) => f.name)).toEqual(['id', 'studentId', 'courseId']);
    });

    it('缺 joinTable → 名取 `${parent}_${child}`', () => {
      const joins = synthesizeJoinEntities([student, course], [{ parent: 'student', child: 'course', cardinality: 'N-N' }]);
      expect(joins[0].table).toBe('student_course');
    });

    it('中间表已存在 / 两端实体缺失 → 跳过（幂等）', () => {
      const existing: ParsedModel = { name: 'StudentCourse', table: 'student_course', fields: [field('id', { isId: true })] };
      expect(synthesizeJoinEntities([student, course, existing], nn)).toHaveLength(0);
      expect(synthesizeJoinEntities([student], nn)).toHaveLength(0);
    });

    it('N—N 不在两端实体上补外键、中间表自身仍 crud', () => {
      const joins = synthesizeJoinEntities([student, course], nn);
      const all = ensureFkColumns([student, course, ...joins], nn);
      expect(all.find((e) => e.table === 'student')!.fields.some((f) => f.name.endsWith('Id'))).toBe(false);
      expect(genTableMeta(all.find((e) => e.table === 'student_course')!, all, nn).tplCategory).toBe('crud');
    });
  });
});
