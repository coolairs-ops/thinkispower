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
}
