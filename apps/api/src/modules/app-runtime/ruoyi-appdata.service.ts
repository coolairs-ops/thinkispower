import { Injectable, Logger } from '@nestjs/common';
import { loadRuoyiInstanceConfig, RuoyiInstanceConfig } from './ruoyi-provision.config';
import { injectLoginGate } from './ruoyi-login-gate';

/**
 * serve 层若依接入（适配器②·A 架构）。
 *
 * 前端 HTML 生成时烘焙的 /api/app 客户端（自带 login/session，见 cloudecode.injectAppDataClient）**保留不动**；
 * serve 时若项目后端是若依且已就绪，仅**注入登录门**（ruoyi-login-gate）：
 *   终端用户登录 → 平台 /api/app 代理按**本人 token** 调若依（data_scope 生效），浏览器**不放任何若依 token**。
 * 非若依 / 未就绪 / 未配实例 / 空 html → 原样返回（路B 不变；置备中保持路B，避免显示尚不存在的若依数据）。
 *
 * 注：旧版"剥路B appData + 注若依直连 appData + 服务端 admin token"已退役（全员共用 admin token →
 * data_scope 失效 + token 进浏览器的安全漏洞）。同源托管画像页那条另有 ruoyi-appdata.injector 提供。
 */
@Injectable()
export class RuoyiAppDataService {
  private readonly logger = new Logger(RuoyiAppDataService.name);
  private readonly cfg: RuoyiInstanceConfig;

  constructor() {
    this.cfg = loadRuoyiInstanceConfig();
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  /** 若依+ready → 注入登录门（保留 /api/app 客户端）；其余原样返回。appName 用作登录框标题。 */
  async transform(html: string | null | undefined, backendRuntime: unknown, appName = '应用'): Promise<string | null | undefined> {
    const be = backendRuntime as { kind?: string; status?: string } | null;
    if (!html || !this.cfg.enabled || be?.kind !== 'ruoyi' || be?.status !== 'ready') return html;
    this.logger.log(`serve 注入若依登录门 app=${appName}`);
    return injectLoginGate(html, appName);
  }
}
