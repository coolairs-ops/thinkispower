/**
 * ParsedModel → MySQL CREATE TABLE（ADR-0003 M3c）。
 *
 * provision 的前置步：若依 codegen 的 importTable 从「已存在的表」反射列，
 * 所以要先据实体模型在若依 DB 建表。列类型复用 ruoyi-mapping 的 PRISMA_TO_RUOYI（MySQL 档），
 * 与喂给 gen_table_column 的类型保持一致。纯函数、确定性、标识符用反引号包。
 */
import { ModelField, ParsedModel } from './data-model.types';
import { PRISMA_TO_RUOYI } from './ruoyi-mapping';

/**
 * 路B 模型默认值（Postgres 风格 defaultSql）→ 若依 MySQL 默认值（写入翻译）。
 * 没这一层，`@default("C")`/`@default(now())`/`@default(cuid())` 到若依成"无默认 NOT NULL 列"，
 * insert 不提供这些字段就 500。MySQL 8.0.13+ 支持表达式默认 `(UUID())`。
 */
function mysqlDefault(f: ModelField): string {
  const d = f.defaultSql;
  if (!d) return '';
  if (d === 'now()') return ' default CURRENT_TIMESTAMP'; // @default(now()) 与 @updatedAt（insert 够用，不加 ON UPDATE）
  if (d === 'gen_random_uuid()::text') return ' default (UUID())'; // cuid()/uuid() String 主键 → DB 生成
  if (d === 'true') return ' default 1';
  if (d === 'false') return ' default 0';
  if (/^-?\d+(\.\d+)?$/.test(d)) return ` default ${d}`; // 数字字面量
  if (/^'[^']*'$/.test(d)) return ` default ${d}`; // 字符串字面量（解析器已做安全过滤）
  return '';
}

function column(f: ModelField): string {
  const rule = PRISMA_TO_RUOYI[f.prismaType] ?? PRISMA_TO_RUOYI.String;
  // 整型主键用自增（自增列不带默认）；String/cuid 主键等用 DB 默认（如 UUID()），不再要应用层赋值
  const auto = f.isId && (f.prismaType === 'Int' || f.prismaType === 'BigInt') ? ' auto_increment' : '';
  const def = auto ? '' : mysqlDefault(f);
  // 有默认值的非主键列设为可空 → 若依 importTable 反射 isRequired=0、生成的 BO 不 @NotNull，
  // 用户不填也由 DB 默认补（否则 createdAt/level 等 NOT NULL 会被 BO 校验挡下 → insert 500）。主键保持非空。
  const nullable = f.optional || (!!def && !f.isId);
  const nullness = nullable ? 'null' : 'not null';
  return `  \`${f.name}\` ${rule.columnType} ${nullness}${auto}${def} comment '${f.name}'`;
}

/**
 * 若依-Plus 业务表必备的标准基础列（M3c-remaining 端到端实测得：缺则 list 报 Unknown column 'tenant_id'、
 * insert 报 Unknown column 'create_dept'）。codegen 的实体继承 TenantEntity/BaseEntity 自带这些字段、
 * 不在 gen_table_column 里，但**表必须有**——MyBatis-Plus 租户拦截器加 `WHERE tenant_id`、审计自动填充写这几列。
 * 列名/类型对齐若依内置表（sys_*）。LLM 产的 ParsedModel 没有，建表时补齐（已存在同名则跳过）。
 */
const RUOYI_BASE_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'create_dept', ddl: "`create_dept` bigint null comment '创建部门'" },
  { name: 'create_by', ddl: "`create_by` bigint null comment '创建者'" },
  { name: 'create_time', ddl: "`create_time` datetime null comment '创建时间'" },
  { name: 'update_by', ddl: "`update_by` bigint null comment '更新者'" },
  { name: 'update_time', ddl: "`update_time` datetime null comment '更新时间'" },
  { name: 'tenant_id', ddl: "`tenant_id` varchar(20) default '000000' comment '租户编号'" },
];

/**
 * 生成幂等 CREATE TABLE（if not exists）。表名/列名反引号包，防注入与关键字冲突。
 * 自动补齐若依基础列（租户 + 审计），实体已含同名列则不重复加。
 */
export function toMysqlCreateTable(model: ParsedModel): string {
  const have = new Set(model.fields.map((f) => f.name.toLowerCase()));
  const lines = model.fields.map(column);
  for (const base of RUOYI_BASE_COLUMNS) {
    if (!have.has(base.name)) lines.push(`  ${base.ddl}`);
  }
  const pk = model.fields.find((f) => f.isId);
  if (pk) lines.push(`  primary key (\`${pk.name}\`)`);
  return `create table if not exists \`${model.table}\` (\n${lines.join(',\n')}\n) comment='${model.name}';`;
}
