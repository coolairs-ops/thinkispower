import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RuoyiClient } from './ruoyi-client.service';
import { loadRuoyiInstanceConfig, RuoyiInstanceConfig } from './ruoyi-provision.config';

/**
 * 终端用户数据代理（适配器②·A 架构）——平台**按当前登录用户代持若依 token 转发**。
 *
 * 解决"全员共用 admin token → data_scope 形同虚设 + token 进浏览器"的生产硬伤：
 *   终端用户在交付 App 里登录（若依 sys_user）→ 平台调若依 /auth/login 换得**本人** token →
 *   存服务端、回一个不可逆的 session（浏览器只拿 session，永远见不到若依 token）→
 *   之后每次 CRUD 平台用本人 token 调 /system/<resource>，**data_scope 真按人生效**（普通用户看自己/领导看全部）。
 *
 * 前端 HTML 一行不改：仍调 /api/app/<pid>/<resource>（路B 那套形状），由 AppRuntimeController 按
 * backendRuntime 分流到本代理；返回值映射回路B appData 契约（list→{data,total}）。
 */
interface SessionEntry {
  token: string;
  user: string;
  exp: number;
}

@Injectable()
export class RuoyiDataProxyService {
  private readonly logger = new Logger(RuoyiDataProxyService.name);
  private readonly cfg: RuoyiInstanceConfig;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly ttlMs = 30 * 60 * 1000;

  constructor(private readonly client: RuoyiClient) {
    this.cfg = loadRuoyiInstanceConfig();
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  /** 终端用户登录（若依账号）：换本人 token 存服务端，回不可逆 session。账密只在服务端用、不落浏览器。 */
  async login(username: string, password: string): Promise<{ session: string; user: string; expiresInMs: number }> {
    let token: string;
    try {
      token = await this.client.login({ ...this.cfg.client, username, password });
    } catch (e) {
      this.logger.warn(`终端用户登录失败 user=${username}: ${e instanceof Error ? e.message : e}`);
      throw new UnauthorizedException('业务账号不存在或密码不正确，请使用交付页提供的应用账号登录');
    }
    const session = randomUUID();
    this.sessions.set(session, { token, user: username, exp: Date.now() + this.ttlMs });
    this.logger.log(`终端用户登录 user=${username} → 颁发 session`);
    return { session, user: username, expiresInMs: this.ttlMs };
  }

  logout(session: string): void {
    this.sessions.delete(session);
  }

  /** session → 本人 token；无/过期 → 401（强制以本人身份调若依，data_scope 据此生效，不退 admin）。 */
  private tokenFor(session: string | undefined): string {
    const e = session ? this.sessions.get(session) : undefined;
    if (!e) throw new UnauthorizedException('未登录或会话不存在');
    if (e.exp <= Date.now()) {
      this.sessions.delete(session!);
      throw new UnauthorizedException('会话已过期，请重新登录');
    }
    return e.token;
  }

  // ─── CRUD：以 session 用户身份调若依，映射回路B appData 契约 ───

  async list(
    resource: string,
    session: string | undefined,
    opts: { page?: number; pageSize?: number; filters?: Record<string, unknown> },
  ): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
    const { rows, total } = await this.client.dataList(this.cfg.client, this.tokenFor(session), resource, opts);
    return { data: rows, total, page: opts.page ?? 1, pageSize: opts.pageSize ?? 10 };
  }

  async get(resource: string, session: string | undefined, id: string): Promise<{ data: any }> {
    return { data: await this.client.dataGet(this.cfg.client, this.tokenFor(session), resource, id) };
  }

  async create(resource: string, session: string | undefined, body: Record<string, unknown>): Promise<{ data: any }> {
    const data = await this.client.dataCreate(this.cfg.client, this.tokenFor(session), resource, body);
    return { data: data ?? true };
  }

  async update(resource: string, session: string | undefined, id: string, body: Record<string, unknown>): Promise<{ data: any }> {
    const data = await this.client.dataUpdate(this.cfg.client, this.tokenFor(session), resource, { ...body, id });
    return { data: data ?? true };
  }

  async remove(resource: string, session: string | undefined, id: string): Promise<Record<string, never>> {
    await this.client.dataRemove(this.cfg.client, this.tokenFor(session), resource, id);
    return {};
  }
}
