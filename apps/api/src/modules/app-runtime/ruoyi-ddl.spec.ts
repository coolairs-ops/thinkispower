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
});
