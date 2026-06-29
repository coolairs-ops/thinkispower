import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConsoleServeConfig, createConsoleServer } from './console-serve';

/**
 * 控制台「托管 serve」生命周期（候选② serve 自动化）：交付时 build:prod 后由平台自起一个受管静态服务
 * （serve dist + 代理 /prod-api→若依），产出真实 productionUrl，替代手工 vite preview / 手配 nginx。
 *
 * - NestJS 单例：服务进程内只起一份，跨多次交付幂等复用（文件实时读盘，重构建自动反映，无需重启）。
 * - 默认关闭：仅 RUOYI_CONSOLE_SERVE=managed 才接管；未开/失败 → 返回 null，交付侧回落 RUOYI_CONSOLE_URL。
 */
@Injectable()
export class ConsoleServeService implements OnModuleDestroy {
  private readonly logger = new Logger(ConsoleServeService.name);
  private server?: Server;
  private servedUrl?: string;

  /** 确保控制台已被托管 serve；返回对外 URL。未开启/dist 缺失/启动失败 → null（调用方回落 env）。 */
  async ensureServed(uiRoot: string, backendUrl: string): Promise<string | null> {
    const cfg = resolveConsoleServeConfig();
    if (!cfg) return null; // 未开启托管模式

    const distDir = join(uiRoot, 'dist');
    if (!existsSync(join(distDir, 'index.html'))) {
      this.logger.warn(`托管 serve：dist 缺 index.html(${distDir})，回落 env`);
      return null;
    }

    if (this.server && this.servedUrl) return this.servedUrl; // 幂等复用

    try {
      const server = createConsoleServer({ distDir, backendUrl, apiPrefix: cfg.apiPrefix });
      await new Promise<void>((res, rej) => {
        server.once('error', rej);
        server.listen(cfg.port, cfg.host, () => res());
      });
      this.server = server;
      // 实际监听端口（支持 port=0 临时端口）；有显式 publicUrl(反代/域名)则优先。
      const actualPort = (server.address() as AddressInfo).port;
      this.servedUrl = cfg.publicUrl || `http://${cfg.host}:${actualPort}`;
      this.logger.log(`控制台托管 serve 已起：${this.servedUrl}（dist=${distDir} → 代理 ${cfg.apiPrefix} → ${backendUrl}）`);
      return this.servedUrl;
    } catch (e) {
      this.logger.warn(`控制台托管 serve 启动失败(${cfg.host}:${cfg.port})：${e instanceof Error ? e.message : e}；回落 env`);
      return null;
    }
  }

  onModuleDestroy(): void {
    this.server?.close();
  }
}
