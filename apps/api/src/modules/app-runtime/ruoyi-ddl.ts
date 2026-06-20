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

/** 生成幂等 CREATE TABLE（if not exists）。表名/列名反引号包，防注入与关键字冲突。 */
export function toMysqlCreateTable(model: ParsedModel): string {
  const lines = model.fields.map(column);
  const pk = model.fields.find((f) => f.isId);
  if (pk) lines.push(`  primary key (\`${pk.name}\`)`);
  return `create table if not exists \`${model.table}\` (\n${lines.join(',\n')}\n) comment='${model.name}';`;
}
