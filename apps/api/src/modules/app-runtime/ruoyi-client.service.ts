import { Injectable, Logger } from '@nestjs/common';

/**
 * 若依 codegen REST 客户端（ADR-0003 M3b）。
 *
 * 据 M1 源码 + M3 实测确认的流程驱动 RuoYi-Vue-Plus 的 /tool/gen：
 *   login(拿JWT) → importTable(从已存在的表反射列) → findTableId → previewCode(返回 Map<文件,代码>)
 * 是 RuoyiRuntime.provision「实体→若依生成源码」那一步的真实接法（表创建 + build 部署属 M3c）。
 *
 * 起实例实测的坑已内化：多客户端登录带 clientId；接口加密/验证码需在实例侧关或由本端实现握手
 * （M3b 假定实例已关 api-decrypt/captcha，见 docs/architecture/ruoyi-integration-design.md §4）。
 */
export interface RuoyiClientConfig {
  baseUrl: string; // 如 http://127.0.0.1:8080
  clientId: string;
  username: string;
  password: string;
  tenantId: string;
}

@Injectable()
export class RuoyiClient {
  private readonly logger = new Logger(RuoyiClient.name);

  /** 登录拿 access_token。 */
  async login(cfg: RuoyiClientConfig): Promise<string> {
    const body = {
      clientId: cfg.clientId,
      grantType: 'password',
      username: cfg.username,
      password: cfg.password,
      tenantId: cfg.tenantId,
    };
    const data = await this.post(cfg, '/auth/login', body);
    const token = data?.data?.access_token;
    if (!token) throw new Error(`若依登录失败: ${JSON.stringify(data).slice(0, 200)}`);
    return token;
  }

  /** 从已存在的 DB 表反射列结构，导入 gen_table。 */
  async importTable(cfg: RuoyiClientConfig, token: string, tableName: string, dataName = 'master'): Promise<void> {
    const url = `/tool/gen/importTable?tables=${encodeURIComponent(tableName)}&dataName=${dataName}`;
    const data = await this.post(cfg, url, undefined, token);
    if (data?.code !== 200) throw new Error(`importTable 失败: ${JSON.stringify(data).slice(0, 200)}`);
  }

  /** 按表名查 gen_table 的 tableId。 */
  async findTableId(cfg: RuoyiClientConfig, token: string, tableName: string): Promise<number> {
    const data = await this.get(cfg, `/tool/gen/list?tableName=${encodeURIComponent(tableName)}`, token);
    const rows = (data?.rows ?? data?.data ?? []) as Array<{ tableId: number; tableName: string }>;
    const row = rows.find((r) => r.tableName === tableName) ?? rows[0];
    if (!row?.tableId) throw new Error(`未找到 gen_table: ${tableName}`);
    return row.tableId;
  }

  /** 预览生成代码：返回 { 文件名: 代码 }（内存，不落盘）。 */
  async previewCode(cfg: RuoyiClientConfig, token: string, tableId: number): Promise<Record<string, string>> {
    const data = await this.get(cfg, `/tool/gen/preview/${tableId}`, token);
    const files = (data?.data ?? {}) as Record<string, string>;
    if (Object.keys(files).length === 0) throw new Error(`preview 无产物: tableId=${tableId}`);
    return files;
  }

  /** 编排：登录→导表→取码。返回生成的源码文件集。 */
  async generate(cfg: RuoyiClientConfig, tableName: string): Promise<Record<string, string>> {
    const token = await this.login(cfg);
    await this.importTable(cfg, token, tableName);
    const tableId = await this.findTableId(cfg, token, tableName);
    const files = await this.previewCode(cfg, token, tableId);
    this.logger.log(`若依 codegen ${tableName}: 产出 ${Object.keys(files).length} 个文件`);
    return files;
  }

  /**
   * 下载生成代码 zip（download 端点，返回二进制）。
   * 与 preview 不同：zip 内是**正确的若依工程相对路径**（main/java/.../Xxx.java、main/resources/mapper/...），
   * 部署驱动据此落盘，无需手工映射模板名→路径。
   */
  async downloadZip(cfg: RuoyiClientConfig, token: string, tableId: number): Promise<Buffer> {
    const res = await fetch(`${cfg.baseUrl}/tool/gen/download/${tableId}`, {
      method: 'GET',
      headers: this.headers(token, cfg),
    });
    if (!res.ok) throw new Error(`download 失败: tableId=${tableId} HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error(`download 空 zip: tableId=${tableId}`);
    return buf;
  }

  /** 导表并下载 zip（部署驱动用）：登录→importTable→findTableId→downloadZip。 */
  async importAndDownload(cfg: RuoyiClientConfig, tableName: string): Promise<Buffer> {
    const token = await this.login(cfg);
    await this.importTable(cfg, token, tableName);
    const tableId = await this.findTableId(cfg, token, tableName);
    return this.downloadZip(cfg, token, tableId);
  }

  // ─── RBAC 运行时配（混合管线：角色/数据权限走运行时 SQL，零重编译，见 ADR-0003 §4）───

  /** 已存在角色的 roleKey 集合（幂等 seed 用，避免重复建）。 */
  async listRoleKeys(cfg: RuoyiClientConfig, token: string): Promise<Set<string>> {
    const data = await this.get(cfg, `/system/role/list?pageNum=1&pageSize=200`, token);
    const rows = (data?.rows ?? data?.data?.rows ?? []) as Array<{ roleKey: string }>;
    return new Set(rows.map((r) => r.roleKey).filter(Boolean));
  }

  /**
   * 建角色（sys_role），核心是 dataScope 数据权限：'1'全部 / '5'仅本人（demo 修不出、若依开箱即有那块）。
   * menuIds 留空＝不挂菜单权限（超管不受限；普通角色的菜单挂载随 codegen 菜单 seed 后另配）。
   */
  async createRole(
    cfg: RuoyiClientConfig,
    token: string,
    role: { roleName: string; roleKey: string; dataScope: string; roleSort?: number; menuIds?: number[] },
  ): Promise<void> {
    const body = {
      roleName: role.roleName,
      roleKey: role.roleKey,
      roleSort: role.roleSort ?? 1,
      dataScope: role.dataScope,
      status: '0',
      menuCheckStrictly: true,
      deptCheckStrictly: true,
      menuIds: role.menuIds ?? [],
      deptIds: [],
    };
    const data = await this.post(cfg, '/system/role', body, token);
    if (data?.code !== 200) throw new Error(`createRole 失败(${role.roleKey}): ${JSON.stringify(data).slice(0, 200)}`);
  }

  /** 幂等 seed 一批角色：已存在 roleKey 跳过。返回新建数。 */
  async seedRoles(
    cfg: RuoyiClientConfig,
    roles: Array<{ roleName: string; roleKey: string; dataScope: string; roleSort?: number }>,
  ): Promise<{ created: number; skipped: number }> {
    const token = await this.login(cfg);
    const existing = await this.listRoleKeys(cfg, token);
    let created = 0;
    let skipped = 0;
    for (const r of roles) {
      if (existing.has(r.roleKey)) {
        skipped++;
        continue;
      }
      await this.createRole(cfg, token, r);
      created++;
    }
    this.logger.log(`若依 RBAC seed: 新建 ${created} 角色 / 跳过 ${skipped}（已存在）`);
    return { created, skipped };
  }

  // ─── 终端用户数据代理（适配器②·服务端版：按**本人 token** 调 /system/<resource>，data_scope 据此生效）───
  // 路B appData 契约 ←→ 若依 REST 的转译统一收在这里（原在浏览器注入器里，现搬服务端，浏览器不见若依 token）。

  /** list：page/pageSize/filters → pageNum/pageSize/查询参；返回若依 {rows,total}。 */
  async dataList(
    cfg: RuoyiClientConfig,
    token: string,
    resource: string,
    q: { page?: number; pageSize?: number; filters?: Record<string, unknown> },
  ): Promise<{ rows: any[]; total: number }> {
    const qs = new URLSearchParams();
    qs.set('pageNum', String(q.page ?? 1));
    qs.set('pageSize', String(q.pageSize ?? 10));
    for (const [k, v] of Object.entries(q.filters ?? {})) if (v != null && v !== '') qs.set(k, String(v));
    const data = await this.get(cfg, `/system/${resource}/list?${qs.toString()}`, token);
    this.ensureOk(data, `list ${resource}`);
    return { rows: data?.rows ?? [], total: data?.total ?? 0 };
  }

  async dataGet(cfg: RuoyiClientConfig, token: string, resource: string, id: string): Promise<any> {
    const data = await this.get(cfg, `/system/${resource}/${encodeURIComponent(id)}`, token);
    this.ensureOk(data, `get ${resource}`);
    return data?.data;
  }

  async dataCreate(cfg: RuoyiClientConfig, token: string, resource: string, body: Record<string, unknown>): Promise<any> {
    const data = await this.post(cfg, `/system/${resource}`, body, token);
    this.ensureOk(data, `create ${resource}`);
    return data?.data;
  }

  /** update：若依 PUT 把 id 放 body。 */
  async dataUpdate(cfg: RuoyiClientConfig, token: string, resource: string, body: Record<string, unknown>): Promise<any> {
    const data = await this.put(cfg, `/system/${resource}`, body, token);
    this.ensureOk(data, `update ${resource}`);
    return data?.data;
  }

  async dataRemove(cfg: RuoyiClientConfig, token: string, resource: string, id: string): Promise<void> {
    const data = await this.del(cfg, `/system/${resource}/${encodeURIComponent(id)}`, token);
    this.ensureOk(data, `remove ${resource}`);
  }

  /** 若依以 HTTP 200 外壳 + body.code 表状态（鉴权失败是 200+code:401）；非 200 抛错，401 单独标。 */
  private ensureOk(data: any, what: string): void {
    const code = data?.code;
    if (code === 200) return;
    if (code === 401) throw new Error(`若依鉴权失败(${what})：${data?.msg ?? '需登录/clientid'}`);
    throw new Error(`若依${what}失败：${JSON.stringify(data).slice(0, 200)}`);
  }

  // ─── HTTP ───
  private headers(token?: string, cfg?: RuoyiClientConfig): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    if (cfg?.clientId) h.clientid = cfg.clientId;
    return h;
  }

  private async post(cfg: RuoyiClientConfig, path: string, body?: unknown, token?: string): Promise<any> {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(token, cfg),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  }

  private async get(cfg: RuoyiClientConfig, path: string, token?: string): Promise<any> {
    const res = await fetch(`${cfg.baseUrl}${path}`, { method: 'GET', headers: this.headers(token, cfg) });
    return res.json();
  }

  private async put(cfg: RuoyiClientConfig, path: string, body?: unknown, token?: string): Promise<any> {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.headers(token, cfg),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  }

  private async del(cfg: RuoyiClientConfig, path: string, token?: string): Promise<any> {
    const res = await fetch(`${cfg.baseUrl}${path}`, { method: 'DELETE', headers: this.headers(token, cfg) });
    return res.json();
  }
}
