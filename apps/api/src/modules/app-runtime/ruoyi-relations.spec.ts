import { ensureFkColumns, genTableMeta } from './ruoyi-relations';
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
});
