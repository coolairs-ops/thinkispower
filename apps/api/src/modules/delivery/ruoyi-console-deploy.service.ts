import { Injectable, Logger } from '@nestjs/common';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { PrismaService } from '../../database/prisma.service';
import { RuoyiClient } from '../app-runtime/ruoyi-client.service';
import { loadRuoyiInstanceConfig } from '../app-runtime/ruoyi-provision.config';
import { decideDeliveryOutcome, DeployResultStatus } from './golive-gate';

const execAsync = promisify(exec);

/**
 * 若依控制台交付（ADR-0012 ②）：以「若依统一控制台」为 ruoyi 项目的交付物，取代链A的 stepwise 自造前端。
 *
 * 流程：确认后端就绪 → 构建控制台前端(plus-ui vite build，产生产 bundle、并在构建期解析 import.meta.glob
 * 把新生成的页纳入，规避 dev 模式新组件不进 glob 的白页) → 验控制台可达 → 冒烟(初始用户登录 + 业务 list 200)
 * → 复用 decideDeliveryOutcome 二值上线门 → 写 goLiveStatus + productionUrl=控制台 URL。
 *
 * 服务边界：构建由平台做；「部署/serve」是环境基建——控制台 URL 由 RUOYI_CONSOLE_URL 提供(CI/容器/preview 服务)。
 */
@Injectable()
export class RuoyiConsoleDeployService {
  private readonly logger = new Logger(RuoyiConsoleDeployService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RuoyiClient,
  ) {}

  /** ruoyi 项目的交付结局：等后端就绪 → 构建+验控制台+冒烟→上线门。写 goLiveStatus/productionUrl。 */
  async deliver(projectId: string): Promise<void> {
    // provision 与本任务并发(各自队列)，provision 含分钟级编译/重启 → 先等后端置备就绪，否则误判 deploy_failed。
    const desc = await this.waitBackendReady(projectId, Number(process.env.RUOYI_CONSOLE_READY_TIMEOUT_MS) || 30 * 60 * 1000);
    const cfg = loadRuoyiInstanceConfig();
    const backendReady = desc.status === 'ready';

    // ① 构建控制台前端(产生产 bundle；构建期 glob 解析→新页纳入，避免 dev 白页)
    const consoleBuilt = backendReady && cfg.deploy.uiRoot ? await this.buildConsole(cfg.deploy.uiRoot) : false;

    // ② 控制台 URL + 可达性（serve 由 RUOYI_CONSOLE_URL 提供）
    const consoleUrl = process.env.RUOYI_CONSOLE_URL || '';
    let deployStatus: DeployResultStatus = 'not_deployed';
    let deployedUrl: string | undefined;
    if (consoleUrl) {
      deployStatus = (await this.reachable(consoleUrl)) ? 'deployed' : 'deploy_failed';
      if (deployStatus === 'deployed') deployedUrl = consoleUrl;
    }

    // ③ 冒烟：初始用户(无则 admin)登录 + 首个业务资源 list 200
    let smokePassed: boolean | undefined;
    if (deployStatus === 'deployed' && backendReady) {
      smokePassed = await this.smoke(cfg, desc);
    }

    // ④ 上线门（backendReady 传 false：强制「控制台可达」为 completed 唯一路径，不让后端就绪单独放行=诚实）
    let outcome;
    if (!backendReady) {
      outcome = { status: 'deploy_failed' as const, productionUrl: null, reason: '若依后端未就绪' };
    } else if (!consoleBuilt) {
      outcome = { status: 'build_failed' as const, productionUrl: null, reason: cfg.deploy.uiRoot ? '控制台前端构建失败' : '未配 RUOYI_UI_ROOT，控制台前端缺失' };
    } else {
      outcome = decideDeliveryOutcome({ compilationPassed: true, deployStatus, deployedUrl, smokePassed, backendReady: false, staticUrl: consoleUrl || '' });
    }

    const labelMap: Record<string, string> = {
      completed: '已上线', preview_only: '仅预览·未上线', build_failed: '编译失败', contract_violation: '前端契约越界', smoke_failed: '冒烟未通过', deploy_failed: '部署失败',
    };
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        goLiveStatus: outcome.status,
        ...(outcome.status === 'completed' ? { status: 'completed' } : {}),
        publicStatusLabel: labelMap[outcome.status] ?? outcome.status,
        productionUrl: outcome.productionUrl,
      },
    });
    this.logger.log(`[控制台上线门] ${outcome.status}: ${outcome.reason}${outcome.productionUrl ? ' → ' + outcome.productionUrl : ''} (built=${consoleBuilt} deploy=${deployStatus} smoke=${smokePassed})`);
  }

  /** 轮询等若依后端置备就绪（与本任务并发的 provision 含分钟级编译/重启）。ready/error 即返回；超时返回最后态。 */
  private async waitBackendReady(projectId: string, timeoutMs: number): Promise<{ status?: string; resources?: string[]; initialUsers?: Array<{ userName: string; password: string }> }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const proj = await this.prisma.project.findUnique({ where: { id: projectId }, select: { backendRuntime: true } });
      const desc = (proj?.backendRuntime ?? {}) as { status?: string; resources?: string[]; initialUsers?: Array<{ userName: string; password: string }> };
      if (desc.status === 'ready' || desc.status === 'error') return desc;
      if (Date.now() > deadline) {
        this.logger.warn(`等后端就绪超时(${Math.round(timeoutMs / 1000)}s)，当前 status=${desc.status ?? '无'}`);
        return desc;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  /** 构建 plus-ui 控制台（vite build）。命令走 env，默认 npm run build。 */
  private async buildConsole(uiRoot: string): Promise<boolean> {
    const cmd = process.env.RUOYI_CONSOLE_BUILD_CMD || 'npm run build:prod'; // plus-ui 生产构建脚本
    try {
      await execAsync(cmd, { cwd: uiRoot, maxBuffer: 128 * 1024 * 1024, timeout: 8 * 60 * 1000 });
      this.logger.log(`控制台构建成功：${cmd} @ ${uiRoot}`);
      return true;
    } catch (e) {
      this.logger.warn(`控制台构建失败（${cmd}）：${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
      return false;
    }
  }

  private async reachable(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'GET' });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  /** 冒烟：用初始用户(回退 admin)登录 + 首个业务资源 list 返 200。 */
  private async smoke(cfg: ReturnType<typeof loadRuoyiInstanceConfig>, desc: { resources?: string[]; initialUsers?: Array<{ userName: string; password: string }> }): Promise<boolean> {
    try {
      const u = desc.initialUsers?.[0];
      const loginCfg = u ? { ...cfg.client, username: u.userName, password: u.password } : cfg.client;
      const token = await this.client.login(loginCfg);
      const resource = (desc.resources ?? [])[0];
      if (!resource) return true; // 无资源可冒烟→不判失败
      const data = await this.client.dataList(cfg.client, token, resource, {});
      return data != null;
    } catch (e) {
      this.logger.warn(`控制台冒烟失败：${e instanceof Error ? e.message : e}`);
      return false;
    }
  }
}
