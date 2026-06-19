/**
 * 思想动力 IR → 若依 codegen 输入（gen_table_column）的纯映射（ADR-0003 M2）。
 *
 * 据 RuoYi-Vue-Plus 源码核实（2026-06-20，见 docs/architecture/ruoyi-integration-design.md §4）：
 * 若依 codegen 的入参是 gen_table + gen_table_column；本模块把 ParsedModel（LLM 产的 Prisma 模型）
 * 映射成若依的列元数据，供 M3 经 /tool/gen REST 接口（importTable→editSave→preview）驱动 codegen。
 *
 * 纯函数、零依赖、零 LLM——确定性映射（ADR-0002 原则①：固定归确定性）。
 */
import { ModelField, ParsedModel } from './data-model.types';

/** 若依 gen_table_column 的核心字段（16 字段里我们映射会用到的；其余由若依默认/M3 细化）。 */
export interface RuoyiColumn {
  columnName: string;
  columnComment: string;
  columnType: string; // DB 列类型（MySQL）
  javaType: string;
  javaField: string;
  htmlType: string; // input/textarea/select/radio/datetime...
  queryType: string; // EQ/NE/GT/LT/LIKE/BETWEEN
  isPk: '0' | '1';
  isIncrement: '0' | '1';
  isRequired: '0' | '1';
  isInsert: '0' | '1';
  isEdit: '0' | '1';
  isList: '0' | '1';
  isQuery: '0' | '1';
  dictType: string;
  sort: number;
}

export interface RuoyiGenTable {
  tableName: string;
  className: string; // 实体类名（PascalCase）
  functionName: string; // 业务功能名（用于菜单/注释）
  columns: RuoyiColumn[];
}

interface TypeRule {
  columnType: string;
  javaType: string;
  htmlType: string;
  queryType: string;
  queryable: boolean; // 默认是否作为查询条件
}

/** Prisma 标量 → 若依列元数据（MySQL 档）。未知类型降级按 String 处理。 */
export const PRISMA_TO_RUOYI: Record<string, TypeRule> = {
  String: { columnType: 'varchar(255)', javaType: 'String', htmlType: 'input', queryType: 'LIKE', queryable: true },
  Int: { columnType: 'int', javaType: 'Integer', htmlType: 'input', queryType: 'EQ', queryable: true },
  BigInt: { columnType: 'bigint', javaType: 'Long', htmlType: 'input', queryType: 'EQ', queryable: true },
  Float: { columnType: 'double', javaType: 'Double', htmlType: 'input', queryType: 'EQ', queryable: false },
  Decimal: { columnType: 'decimal(10,2)', javaType: 'BigDecimal', htmlType: 'input', queryType: 'EQ', queryable: false },
  Boolean: { columnType: 'tinyint(1)', javaType: 'Integer', htmlType: 'radio', queryType: 'EQ', queryable: true },
  DateTime: { columnType: 'datetime', javaType: 'Date', htmlType: 'datetime', queryType: 'BETWEEN', queryable: false },
  Json: { columnType: 'text', javaType: 'String', htmlType: 'textarea', queryType: 'EQ', queryable: false },
};

/** 单个字段 → 若依列。索引用于 sort（1 起）。 */
export function toRuoyiColumn(field: ModelField, index: number): RuoyiColumn {
  const rule = PRISMA_TO_RUOYI[field.prismaType] ?? PRISMA_TO_RUOYI.String;
  return {
    columnName: field.name,
    columnComment: field.name, // ParsedModel 暂无中文注释；M3 可由更丰富的 IR 补
    columnType: rule.columnType,
    javaType: rule.javaType,
    javaField: field.name,
    htmlType: rule.htmlType,
    queryType: rule.queryType,
    isPk: field.isId ? '1' : '0',
    isIncrement: '0', // 平台用 LLM 产的 id（uuid/雪花），不靠 DB 自增
    isRequired: field.optional ? '0' : '1',
    isInsert: '1',
    isEdit: field.isId ? '0' : '1', // 主键不可编辑
    isList: '1',
    isQuery: rule.queryable && !field.isId ? '1' : '0',
    dictType: '',
    sort: index + 1,
  };
}

/** 实体模型 → 若依 gen_table（含列）。 */
export function toRuoyiGenTable(model: ParsedModel): RuoyiGenTable {
  return {
    tableName: model.table,
    className: model.name,
    functionName: model.name,
    columns: model.fields.map((f, i) => toRuoyiColumn(f, i)),
  };
}
