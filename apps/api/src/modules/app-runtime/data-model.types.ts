/** 从 LLM 产出的 Prisma schema 文本里解析出的、可安全物化为表列的数据模型。 */

/** 受支持的 Prisma 标量类型 → Postgres 列类型 白名单（约束①：用真 Prisma 类型，不自创 DSL） */
export const SCALAR_TYPE_MAP: Record<string, string> = {
  String: 'text',
  Int: 'integer',
  BigInt: 'bigint',
  Float: 'double precision',
  Decimal: 'numeric',
  Boolean: 'boolean',
  DateTime: 'timestamptz',
  Json: 'jsonb',
};

export interface ModelField {
  name: string;
  /** 原始 Prisma 标量类型名（已在白名单内） */
  prismaType: string;
  optional: boolean;
  isId: boolean;
  isUnique: boolean;
  /** 归一化后的默认值表达式（已校验安全），undefined = 无默认 */
  defaultSql?: string;
}

export interface ParsedModel {
  /** Prisma 模型名（PascalCase） */
  name: string;
  /** 物化表名（小写资源名） */
  table: string;
  fields: ModelField[];
}
