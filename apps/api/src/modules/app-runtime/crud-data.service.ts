import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BackendRuntimeDescriptor } from './backend-runtime.interface';

/**
 * 通用 CRUD 数据服务（ADR-0001 / slice 4）。
 *
 * 元数据驱动：从 `Project.backendRuntime` 描述符拿到 schema + 资源白名单，
 * 再从 information_schema 读列与主键，对该项目 `proj_<id>` schema 里的真实表做 CRUD。
 *
 * 安全模型（与 SchemaMigrationService 一致）：
 *   - 表/列名只来自「资源白名单 + information_schema 实际列」，并经标识符正则校验后才拼接；
 *   - 所有「值」一律走参数化占位符（$1,$2…），绝不拼接进 SQL；
 *   - 过滤比较统一用 `"col"::text = $n`，避免类型不匹配，也避免任何值进 SQL 文本。
 */
@Injectable()
export class CrudDataService {
  private readonly logger = new Logger(CrudDataService.name);
  private static readonly IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

  constructor(private prisma: PrismaService) {}

  async list(
    projectId: string,
    resource: string,
    q: { page?: number; pageSize?: number; sort?: string; filters?: Record<string, string> },
  ): Promise<{ data: unknown[]; page: number; pageSize: number; total: number }> {
    const t = await this.resolve(projectId, resource);

    const params: unknown[] = [];
    const where: string[] = [];
    for (const [k, v] of Object.entries(q.filters ?? {})) {
      if (t.columns.has(k)) {
        params.push(v);
        where.push(`"${k}"::text = $${params.length}`);
      }
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    let orderSql = '';
    if (q.sort) {
      const [field, dir] = q.sort.split(':');
      if (t.columns.has(field)) {
        orderSql = ` ORDER BY "${field}" ${dir?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`;
      }
    }

    const pageSize = Math.min(Math.max(Math.trunc(q.pageSize ?? 20) || 20, 1), 100);
    const page = Math.max(Math.trunc(q.page ?? 1) || 1, 1);
    const offset = (page - 1) * pageSize;

    const countRows = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ${t.ref}${whereSql}`,
      ...params,
    );
    const total = countRows[0]?.n ?? 0;

    const dataParams = [...params, pageSize, offset];
    const data = await this.prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM ${t.ref}${whereSql}${orderSql} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      ...dataParams,
    );

    return { data, page, pageSize, total };
  }

  async get(projectId: string, resource: string, id: string): Promise<{ data: unknown }> {
    const t = await this.resolve(projectId, resource);
    const rows = await this.prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM ${t.ref} WHERE "${t.pk}" = $1`,
      id,
    );
    if (!rows.length) throw new NotFoundException('记录不存在');
    return { data: rows[0] };
  }

  async create(projectId: string, resource: string, body: Record<string, unknown>): Promise<{ data: unknown }> {
    const t = await this.resolve(projectId, resource);
    const cols = Object.keys(body ?? {}).filter((k) => t.columns.has(k));

    let rows: unknown[];
    if (cols.length === 0) {
      rows = await this.prisma.$queryRawUnsafe<unknown[]>(`INSERT INTO ${t.ref} DEFAULT VALUES RETURNING *`);
    } else {
      const params: unknown[] = [];
      const placeholders = cols.map((c) => this.bind(t, c, body[c], params));
      rows = await this.prisma.$queryRawUnsafe<unknown[]>(
        `INSERT INTO ${t.ref} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        ...params,
      );
    }
    return { data: rows[0] };
  }

  /** PUT/PATCH 共用：v1 都按"更新提供的字段"语义（部分更新），主键不可改。 */
  async update(projectId: string, resource: string, id: string, body: Record<string, unknown>): Promise<{ data: unknown }> {
    const t = await this.resolve(projectId, resource);
    const cols = Object.keys(body ?? {}).filter((k) => t.columns.has(k) && k !== t.pk);
    if (cols.length === 0) return this.get(projectId, resource, id);

    const params: unknown[] = [];
    const sets = cols.map((c) => `"${c}" = ${this.bind(t, c, body[c], params)}`);
    params.push(id);
    const rows = await this.prisma.$queryRawUnsafe<unknown[]>(
      `UPDATE ${t.ref} SET ${sets.join(', ')} WHERE "${t.pk}" = $${params.length} RETURNING *`,
      ...params,
    );
    if (!rows.length) throw new NotFoundException('记录不存在');
    return { data: rows[0] };
  }

  async remove(projectId: string, resource: string, id: string): Promise<{ data: { id: string } }> {
    const t = await this.resolve(projectId, resource);
    const rows = await this.prisma.$queryRawUnsafe<unknown[]>(
      `DELETE FROM ${t.ref} WHERE "${t.pk}" = $1 RETURNING "${t.pk}"`,
      id,
    );
    if (!rows.length) throw new NotFoundException('记录不存在');
    return { data: { id } };
  }

  // ─── 内部：解析后端描述符 + 读表元数据 ───

  private async resolve(
    projectId: string,
    resource: string,
  ): Promise<{ ref: string; pk: string; columns: Map<string, string> }> {
    if (!CrudDataService.IDENT.test(resource)) throw new NotFoundException('资源不存在');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { backendRuntime: true },
    });
    const d = project?.backendRuntime as unknown as BackendRuntimeDescriptor | null;
    if (!d || !d.schemaName) throw new NotFoundException('该应用还没有数据服务');
    // 资源名大小写不敏感解析：appData 客户端常按模型名传驼峰(dailyStats)，
    // 而置备的资源/表名是小写(dailystats)；用白名单里的规范名做后续查询与 SQL 拼接。
    const canonical = d.resources?.find((r) => r.toLowerCase() === resource.toLowerCase());
    if (!canonical) throw new NotFoundException(`资源不存在: ${resource}`);
    if (!CrudDataService.IDENT.test(canonical)) throw new BadRequestException('后端配置异常');
    if (!CrudDataService.IDENT.test(d.schemaName)) throw new BadRequestException('后端配置异常');

    const colRows = await this.prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      d.schemaName,
      canonical,
    );
    if (colRows.length === 0) throw new NotFoundException('资源不存在');
    const columns = new Map(colRows.map((c) => [c.column_name, c.data_type]));

    const pkRows = await this.prisma.$queryRawUnsafe<{ pk: string }[]>(
      `SELECT a.attname AS pk FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = ($1)::regclass AND i.indisprimary`,
      `"${d.schemaName}"."${canonical}"`,
    );
    const pk = pkRows[0]?.pk ?? 'id';

    return { ref: `"${d.schemaName}"."${canonical}"`, pk, columns };
  }

  /** 把一个写入值绑定为参数化占位符；jsonb 列的对象/数组值序列化后 ::jsonb。 */
  private bind(
    t: { columns: Map<string, string> },
    col: string,
    value: unknown,
    params: unknown[],
  ): string {
    const type = t.columns.get(col);
    if ((type === 'jsonb' || type === 'json') && value !== null && typeof value === 'object') {
      params.push(JSON.stringify(value));
      return `$${params.length}::jsonb`;
    }
    params.push(value);
    return `$${params.length}`;
  }
}
