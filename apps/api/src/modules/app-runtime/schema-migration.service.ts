import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ParsedModel, ModelField, SCALAR_TYPE_MAP } from './data-model.types';

/**
 * 受控迁移服务（ADR-0001 / slice 3）。
 *
 * 把 LLM 产出的 Prisma schema 文本 → 解析 → 校验 → 在 per-project 的
 * Postgres schema（`proj_<id>`）里建表。整个过程**确定性**、无自由 codegen。
 *
 * 安全模型（关键）：唯一会进入 SQL 的用户输入是「标识符」与「白名单类型关键字」，
 * 两者都经严格正则/白名单校验后才拼接；其余一切（默认值、未知类型、裸 SQL）要么归一、
 * 要么直接拒绝。因此即使 schema 文本是恶意的，也无法越过校验注入 SQL。
 */
@Injectable()
export class SchemaMigrationService {
  private readonly logger = new Logger(SchemaMigrationService.name);

  private static readonly IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
  private static readonly MAX_MODELS = 30;
  private static readonly MAX_FIELDS = 60;
  private static readonly PG_IDENT_MAX = 63;

  constructor(private prisma: PrismaService) {}

  /** projectId(uuid) → 安全的 Postgres schema 名 `proj_<uuid下划线化>` */
  schemaNameFor(projectId: string): string {
    const name = `proj_${projectId}`.replace(/-/g, '_');
    if (!SchemaMigrationService.IDENT.test(name) || name.length > SchemaMigrationService.PG_IDENT_MAX) {
      throw new BadRequestException(`非法 projectId，无法派生 schema 名: ${projectId}`);
    }
    return name;
  }

  /**
   * 置备：解析+校验+建表（事务内执行，失败整体回滚）。幂等：可重复调用，
   * 已存在的表/列不会重建（CREATE/ADD ... IF NOT EXISTS）。
   * @returns 物化的 schema 名与资源（表）列表
   */
  async provision(
    projectId: string,
    dataModel: string,
  ): Promise<{ schemaName: string; resources: string[]; models: ParsedModel[] }> {
    const schemaName = this.schemaNameFor(projectId);
    const models = this.parseAndValidate(dataModel);
    const statements = this.buildDdl(schemaName, models);

    await this.prisma.$transaction(async (tx) => {
      for (const stmt of statements) {
        await tx.$executeRawUnsafe(stmt);
      }
    });

    const resources = models.map((m) => m.table);
    this.logger.log(`置备完成 schema=${schemaName} 资源=[${resources.join(', ')}] (${statements.length} 条 DDL)`);
    return { schemaName, resources, models };
  }

  // ─── 解析 + 校验 ───

  /** 解析 Prisma schema 文本并校验为安全的数据模型；任何不安全/不支持的输入抛 BadRequestException。 */
  parseAndValidate(dataModel: string): ParsedModel[] {
    if (!dataModel || !dataModel.trim()) {
      throw new BadRequestException('数据模型为空');
    }

    const stripped = this.stripComments(dataModel);
    const modelBlocks = this.extractModelBlocks(stripped);
    if (modelBlocks.length === 0) {
      throw new BadRequestException('未找到任何 model 定义');
    }
    if (modelBlocks.length > SchemaMigrationService.MAX_MODELS) {
      throw new BadRequestException(`模型数量超限（${modelBlocks.length} > ${SchemaMigrationService.MAX_MODELS}）`);
    }

    const modelNames = new Set(modelBlocks.map((b) => b.name));
    const models = modelBlocks.map((b) => this.parseModel(b.name, b.body, modelNames));

    const tables = new Set<string>();
    for (const m of models) {
      if (tables.has(m.table)) throw new BadRequestException(`资源名重复: ${m.table}`);
      tables.add(m.table);
    }
    return models;
  }

  private stripComments(src: string): string {
    // 去掉 // 与 /// 行注释（保留换行以便定位）
    return src.replace(/\/\/.*$/gm, '');
  }

  private extractModelBlocks(src: string): { name: string; body: string }[] {
    const blocks: { name: string; body: string }[] = [];
    const re = /\bmodel\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      blocks.push({ name: m[1], body: m[2] });
    }
    return blocks;
  }

  private parseModel(name: string, body: string, modelNames: Set<string>): ParsedModel {
    if (!SchemaMigrationService.IDENT.test(name) || name.length > SchemaMigrationService.PG_IDENT_MAX) {
      throw new BadRequestException(`非法模型名: ${name}`);
    }

    const fields: ModelField[] = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('@@')) continue; // 跳过空行与块级属性(@@index/@@map/...)

      const parsed = this.parseField(line, name, modelNames);
      if (parsed) fields.push(parsed); // null = 关系/非列字段，跳过（不物化、不报错）
    }

    if (fields.length === 0) throw new BadRequestException(`模型 ${name} 没有可物化的标量字段`);
    if (fields.length > SchemaMigrationService.MAX_FIELDS) {
      throw new BadRequestException(`模型 ${name} 字段数超限`);
    }
    const ids = fields.filter((f) => f.isId);
    if (ids.length !== 1) throw new BadRequestException(`模型 ${name} 必须且只能有一个 @id 字段`);

    return { name, table: name.toLowerCase(), fields };
  }

  /** 解析单行字段。返回 null 表示该字段是关系/非列字段，应跳过（而非报错）。 */
  private parseField(line: string, modelName: string, modelNames: Set<string>): ModelField | null {
    const tokens = line.split(/\s+/);
    const fieldName = tokens[0];
    let typeToken = tokens[1];
    if (!fieldName || !typeToken) throw new BadRequestException(`模型 ${modelName} 字段定义不完整: "${line}"`);

    if (!SchemaMigrationService.IDENT.test(fieldName) || fieldName.length > SchemaMigrationService.PG_IDENT_MAX) {
      throw new BadRequestException(`模型 ${modelName} 非法字段名: ${fieldName}`);
    }

    const attrs = line.slice(line.indexOf(typeToken) + typeToken.length);
    const isList = typeToken.endsWith('[]');
    const optional = typeToken.endsWith('?');
    const baseType = typeToken.replace(/[\[\]?]+$/g, '');

    // 关系字段（对象关系 / 列表 / 带 @relation）→ 跳过，不物化为列
    if (isList || /@relation\b/.test(attrs) || modelNames.has(baseType)) {
      return null;
    }

    // 到这里必须是白名单标量，否则拒绝
    if (!(baseType in SCALAR_TYPE_MAP)) {
      throw new BadRequestException(`模型 ${modelName} 字段 ${fieldName} 使用了不支持的类型: ${baseType}`);
    }

    let defaultSql = this.parseDefault(attrs, baseType);
    // Prisma @updatedAt 由应用层赋值、DB 列本无默认；通用 CRUD 走原生 SQL 插入不会提供它，
    // 若建成 NOT NULL 无默认会触发 23502（NOT NULL 违反）。给非空 @updatedAt DateTime 兜底 now()。
    if (!defaultSql && baseType === 'DateTime' && /@updatedAt\b/.test(attrs)) {
      defaultSql = 'now()';
    }

    return {
      name: fieldName,
      prismaType: baseType,
      optional,
      isId: /@id\b/.test(attrs),
      isUnique: /@unique\b/.test(attrs),
      defaultSql,
    };
  }

  /** 把 @default(...) 归一为安全的 SQL 默认值表达式；无法识别的默认值忽略（不报错、不注入）。 */
  private parseDefault(attrs: string, prismaType: string): string | undefined {
    // 默认值形态限定为：函数调用 func() / 带引号字符串 / 裸词或数字——三者都不含可注入的括号歧义
    const m = attrs.match(/@default\(\s*([A-Za-z]+\(\)|"[^"]*"|[\w.\-]+)\s*\)/);
    if (!m) return undefined;
    const raw = m[1].trim();

    if (raw === 'uuid()' || raw === 'cuid()') return 'gen_random_uuid()::text';
    if (raw === 'now()') return 'now()';
    if (raw === 'autoincrement()') return undefined; // 由 IDENTITY 处理，见 columnDdl
    if (raw === 'true' || raw === 'false') return raw;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return raw; // 数字字面量
    // 简单字符串字面量（仅允许安全字符，杜绝引号注入）
    const str = raw.match(/^"([\w 一-龥\-.@]*)"$/);
    if (str && prismaType === 'String') return `'${str[1]}'`;

    return undefined; // 其余一律忽略
  }

  // ─── DDL 生成 ───

  /** 生成幂等 DDL：建 schema、建表、补列。所有标识符双引号包裹。 */
  buildDdl(schemaName: string, models: ParsedModel[]): string[] {
    const stmts: string[] = [`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`];

    for (const model of models) {
      const cols = model.fields.map((f) => this.columnDdl(f));
      stmts.push(
        `CREATE TABLE IF NOT EXISTS "${schemaName}"."${model.table}" (\n  ${cols.join(',\n  ')}\n);`,
      );
      // 已存在表时补充后加的列（additive 迁移，幂等）
      for (const f of model.fields) {
        if (f.isId) continue;
        stmts.push(
          `ALTER TABLE "${schemaName}"."${model.table}" ADD COLUMN IF NOT EXISTS ${this.columnDdl(f)};`,
        );
      }
    }
    return stmts;
  }

  private columnDdl(f: ModelField): string {
    const id = `"${f.name}"`;

    // 自增主键特例
    if (f.isId && (f.prismaType === 'Int' || f.prismaType === 'BigInt')) {
      const t = SCALAR_TYPE_MAP[f.prismaType];
      return `${id} ${t} GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`;
    }

    const parts = [id, SCALAR_TYPE_MAP[f.prismaType]];
    if (f.isId) parts.push('PRIMARY KEY');
    else if (!f.optional) parts.push('NOT NULL');
    if (f.isUnique && !f.isId) parts.push('UNIQUE');
    if (f.defaultSql) parts.push(`DEFAULT ${f.defaultSql}`);
    return parts.join(' ');
  }
}
