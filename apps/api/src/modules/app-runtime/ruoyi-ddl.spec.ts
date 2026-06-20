import { toMysqlCreateTable } from './ruoyi-ddl';
import { ModelField, ParsedModel } from './data-model.types';

const field = (over: Partial<ModelField>): ModelField => ({
  name: 'name',
  prismaType: 'String',
  optional: false,
  isId: false,
  isUnique: false,
  ...over,
});

describe('ruoyi-ddl · toMysqlCreateTable（M3c）', () => {
  it('String 主键 → varchar pk、非空、含注释、if not exists 幂等', () => {
    const model: ParsedModel = {
      name: 'Store',
      table: 'demo_store',
      fields: [field({ name: 'id', isId: true }), field({ name: 'store_name' }), field({ name: 'address', optional: true })],
    };
    const sql = toMysqlCreateTable(model);
    expect(sql).toContain('create table if not exists `demo_store`');
    expect(sql).toContain('`id` varchar(255) not null');
    expect(sql).toContain('`address` varchar(255) null');
    expect(sql).toContain('primary key (`id`)');
    expect(sql).toContain("comment='Store'");
  });

  it('整型主键 → auto_increment；各 Prisma 类型映射到 MySQL 列类型', () => {
    const model: ParsedModel = {
      name: 'Task',
      table: 'demo_task',
      fields: [
        field({ name: 'id', prismaType: 'BigInt', isId: true }),
        field({ name: 'amount', prismaType: 'Decimal' }),
        field({ name: 'done', prismaType: 'Boolean' }),
        field({ name: 'created_at', prismaType: 'DateTime', optional: true }),
      ],
    };
    const sql = toMysqlCreateTable(model);
    expect(sql).toContain('`id` bigint not null auto_increment');
    expect(sql).toContain('`amount` decimal(10,2) not null');
    expect(sql).toContain('`done` tinyint(1) not null');
    expect(sql).toContain('`created_at` datetime null');
  });

  it('无主键 → 不产 primary key 子句', () => {
    const sql = toMysqlCreateTable({ name: 'Log', table: 'demo_log', fields: [field({ name: 'msg' })] });
    expect(sql).not.toContain('primary key');
  });

  it('自动补齐若依基础列（租户 + 审计），缺一不可（端到端实测要求）', () => {
    const sql = toMysqlCreateTable({ name: 'Store', table: 'demo_store', fields: [field({ name: 'id', isId: true }), field({ name: 'store_name' })] });
    for (const col of ['create_dept', 'create_by', 'create_time', 'update_by', 'update_time']) {
      expect(sql).toContain(`\`${col}\``);
    }
    expect(sql).toContain("`tenant_id` varchar(20) default '000000'");
  });

  it('实体已含同名基础列 → 不重复添加', () => {
    const sql = toMysqlCreateTable({
      name: 'Store',
      table: 'demo_store',
      fields: [field({ name: 'id', isId: true }), field({ name: 'create_time', prismaType: 'DateTime' }), field({ name: 'tenant_id' })],
    });
    expect(sql.match(/`create_time`/g)).toHaveLength(1);
    expect(sql.match(/`tenant_id`/g)).toHaveLength(1);
  });
});
