import { toRuoyiColumn, toRuoyiGenTable, PRISMA_TO_RUOYI } from './ruoyi-mapping';
import { RuoyiRuntime } from './ruoyi-runtime.service';
import { ModelField, ParsedModel } from './data-model.types';

const field = (over: Partial<ModelField>): ModelField => ({
  name: 'title',
  prismaType: 'String',
  optional: false,
  isId: false,
  isUnique: false,
  ...over,
});

describe('ruoyi-mapping（IR → 若依 codegen 输入 · M2）', () => {
  describe('toRuoyiColumn', () => {
    it('String → varchar/input/LIKE，可查询', () => {
      const c = toRuoyiColumn(field({ name: 'name', prismaType: 'String' }), 0);
      expect(c).toMatchObject({ columnType: 'varchar(255)', javaType: 'String', htmlType: 'input', queryType: 'LIKE', isQuery: '1', sort: 1 });
    });

    it('DateTime → datetime/datetime/BETWEEN，默认不查询', () => {
      const c = toRuoyiColumn(field({ name: 'createdAt', prismaType: 'DateTime' }), 2);
      expect(c).toMatchObject({ columnType: 'datetime', javaType: 'Date', htmlType: 'datetime', queryType: 'BETWEEN', isQuery: '0', sort: 3 });
    });

    it('Boolean → tinyint(1)/radio；Decimal → BigDecimal', () => {
      expect(toRuoyiColumn(field({ prismaType: 'Boolean' }), 0)).toMatchObject({ columnType: 'tinyint(1)', javaType: 'Integer', htmlType: 'radio' });
      expect(toRuoyiColumn(field({ prismaType: 'Decimal' }), 0)).toMatchObject({ javaType: 'BigDecimal', isQuery: '0' });
    });

    it('主键：isPk=1、isEdit=0、isQuery=0；可选字段 isRequired=0', () => {
      const pk = toRuoyiColumn(field({ name: 'id', prismaType: 'String', isId: true }), 0);
      expect(pk).toMatchObject({ isPk: '1', isEdit: '0', isQuery: '0', isIncrement: '0' });
      const opt = toRuoyiColumn(field({ optional: true }), 0);
      expect(opt.isRequired).toBe('0');
      const req = toRuoyiColumn(field({ optional: false }), 0);
      expect(req.isRequired).toBe('1');
    });

    it('未知 Prisma 类型降级按 String 处理（不崩）', () => {
      const c = toRuoyiColumn(field({ prismaType: 'Bytes' as any }), 0);
      const s = PRISMA_TO_RUOYI.String;
      expect(c).toMatchObject({ columnType: s.columnType, javaType: s.javaType, htmlType: s.htmlType, queryType: s.queryType });
    });
  });

  describe('toRuoyiGenTable', () => {
    it('实体 → gen_table，列按序、sort 连续', () => {
      const model: ParsedModel = {
        name: 'Store',
        table: 'store',
        fields: [field({ name: 'id', isId: true }), field({ name: 'name' }), field({ name: 'createdAt', prismaType: 'DateTime' })],
      };
      const t = toRuoyiGenTable(model);
      expect(t).toMatchObject({ tableName: 'store', className: 'Store', functionName: 'Store' });
      expect(t.columns.map((c) => c.columnName)).toEqual(['id', 'name', 'createdAt']);
      expect(t.columns.map((c) => c.sort)).toEqual([1, 2, 3]);
      expect(t.columns[0].isPk).toBe('1');
    });
  });

  describe('RuoyiRuntime 骨架', () => {
    const svc = new RuoyiRuntime();
    it('kind=ruoyi；buildGenTables 把 AppSpec.entities 映射成 gen_table', () => {
      expect(svc.kind).toBe('ruoyi');
      const tables = svc.buildGenTables({
        entities: [{ name: 'Store', table: 'store', fields: [field({ name: 'id', isId: true })] }],
        roles: [{ name: '管理员', dataScope: '1' }],
        menus: [{ name: '门店', path: '/store', entity: 'store' }],
      });
      expect(tables).toHaveLength(1);
      expect(tables[0].tableName).toBe('store');
    });

    it('provision/health/teardown 诚实抛 M3 待实现（不假装能跑）', async () => {
      await expect(svc.provision('p1', 'model X{}')).rejects.toThrow('M3');
      await expect(svc.health('p1', {} as any)).rejects.toThrow('M3');
      await expect(svc.teardown('p1', {} as any)).rejects.toThrow('M3');
    });
  });
});
