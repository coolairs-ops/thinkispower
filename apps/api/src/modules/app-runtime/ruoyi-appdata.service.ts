import { Injectable, Logger } from '@nestjs/common';
import { RuoyiClient } from './ruoyi-client.service';
import { loadRuoyiInstanceConfig, RuoyiInstanceConfig } from './ruoyi-provision.config';
import { injectRuoyiAppData, stripAppData } from './ruoyi-appdata.injector';

/**
 * serve 层 appData 切换（适配器② 自动化）。
 *
 * 前端 HTML 生成时烘焙的是路B appData（指向 /api/app）。serve 时按项目 `backendRuntime`：
 *   - 非若依 / 未配实例 → 原样返回（路B 不变）。
 *   - 若依 → 去掉烘焙的路B appData，换上若依版 appData + 服务端登录得来的短时 token。
 * 于是同一份生成好的好看前端，部署到哪个后端就显示哪个后端的真数据，前端 HTML 不改。
 * token 服务端登录后缓存（默认 20min），不每次 serve 都登录、也不把账密放进浏览器。
 */
@Injectable()
export class RuoyiAppDataService {
  private readonly logger = new Logger(RuoyiAppDataService.name);
  private readonly cfg: RuoyiInstanceConfig;
  private cached?: { token: string; exp: number };

  constructor(private readonly client: RuoyiClient) {
    this.cfg = loadRuoyiInstanceConfig();
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  /** 按项目后端把 html 的 appData 切到若依；非若依/未就绪/未配/空 html → 原样返回（置备中仍走路B）。 */
  async transform(html: string | null | undefined, backendRuntime: unknown): Promise<string | null | undefined> {
    const be = backendRuntime as { kind?: string; status?: string } | null;
    // 只在若依**已就绪**时切；provisioning/error 期间保持路B，避免显示尚不存在的若依数据
    if (!html || !this.cfg.enabled || be?.kind !== 'ruoyi' || be?.status !== 'ready') return html;
    try {
      const token = await this.token();
      const out = injectRuoyiAppData(stripAppData(html), {
        baseUrl: this.cfg.client.baseUrl,
        clientId: this.cfg.client.clientId,
        token,
      });
      return out;
    } catch (e) {
      // 登录/注入失败不该让页面打不开——退回原 html（路B），只记日志。
      this.logger.warn(`若依 appData 注入失败，退回原 html: ${e instanceof Error ? e.message : e}`);
      return html;
    }
  }

  /** 服务端登录拿 token，缓存 20min。 */
  private async token(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.exp > now) return this.cached.token;
    const token = await this.client.login(this.cfg.client);
    this.cached = { token, exp: now + 20 * 60 * 1000 };
    return token;
  }
}
