/**
 * ParsedModel → MySQL CREATE TABLE（ADR-0003 M3c）。
 *
 * provision 的前置步：若依 codegen 的 importTable 从「已存在的表」反射列，
 * 所以要先据实体模型在若依 DB 建表。列类型复用 ruoyi-mapping 的 PRISMA_TO_RUOYI（MySQL 档），
 * 与喂给 gen_table_column 的类型保持一致。纯函数、确定性、标识符用反引号包。
 */
import { ModelField, ParsedModel } from './data-model.types';
import { PRISMA_TO_RUOYI } from './ruoyi-mapping';

function column(f: ModelField): string {
  const rule = PRISMA_TO_RUOYI[f.prismaType] ?? PRISMA_TO_RUOYI.String;
  const nullness = f.optional ? 'null' : 'not null';
  // 整型主键用自增；其余（如 String/uuid 主键）由应用层赋值
  const auto = f.isId && (f.prismaType === 'Int' || f.prismaType === 'BigInt') ? ' auto_increment' : '';
  return `  \`${f.name}\` ${rule.columnType} ${nullness}${auto} comment '${f.name}'`;
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
