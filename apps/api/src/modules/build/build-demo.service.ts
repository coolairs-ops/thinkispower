import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { tailwindCdnUrl, daisyuiCssUrl } from '../../common/asset-urls';
import { buildDemoShell, assembleDemoPages } from '../../integrations/cloudecode/demo-shell';
import { BuildOrchestratorService } from './build-orchestrator.service';

/**
 * demo 专用建造门面（ADR-0005 端到端收尾）：把通用建造编排器接成 demo 全程——
 * 从 planSummary 自动分解模块 → plan → run（逐模块 生成→测试门→续跑）→ 拼装成 demoHtml。
 * start 幂等可重入：被打断后再调一次，plan 跳过、run 续跑对账、再拼装。
 */
@Injectable()
export class BuildDemoService {
  private readonly logger = new Logger(BuildDemoService.name);

  constructor(
    private prisma: PrismaService,
    private orchestrator: BuildOrchestratorService,
    private cloudecode: CloudecodeClient,
  ) {}

  /** 触发一次建造（同步跑完；生产应入队）。ownership 校验。 */
  async start(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, planSummary: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const mods = this.pageItems(project.planSummary);
    await this.orchestrator.plan(projectId, mods.map((m) => ({ name: m.name, spec: m.brief })));
    await this.orchestrator.run(projectId);
    const assembled = await this.assemble(projectId);
    const summary = await this.orchestrator.status(projectId);
    this.logger.log(`建造完成 project ${projectId}: ${assembled.pages} 页 / ${assembled.bytes} bytes`);
    return { ...summary.summary, assembled };
  }

  /** 建造状态（ownership 校验）。 */
  async status(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.orchestrator.status(projectId);
  }

  /** 把 done 模块的页面产物拼成 demoHtml（确定性外壳 + 注入 appData/批注），存库。 */
  async assemble(projectId: string): Promise<{ pages: number; bytes: number }> {
    const [project, modules] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      this.prisma.buildModule.findMany({ where: { projectId, status: 'done' }, orderBy: { orderIdx: 'asc' } }),
    ]);
    if (modules.length === 0) return { pages: 0, bytes: 0 };

    const appName = (project?.name || '应用').slice(0, 20);
    const shellPages = modules.map((m, i) => ({ key: `p${i}`, label: m.name.slice(0, 8) }));
    const shell = buildDemoShell({ appName, tailwindCdn: tailwindCdnUrl(), daisyuiCss: daisyuiCssUrl(), pages: shellPages });

    const pageHtmls: Record<string, string> = {};
    modules.forEach((m, i) => {
      pageHtmls[`p${i}`] = (m.result as { html?: string } | null)?.html || `<div class="alert">「${m.name}」暂无内容</div>`;
    });

    const assembled = assembleDemoPages(shell, pageHtmls);
    const finalHtml = this.cloudecode.injectAnnotationSupport(this.cloudecode.injectAppDataClient(assembled, projectId));
    await this.prisma.project.update({
      where: { id: projectId },
      data: { demoHtml: finalHtml, demoUrl: `/demo/${projectId}`, status: 'demo_ready', publicStatusLabel: '预览已生成' },
    });
    return { pages: modules.length, bytes: finalHtml.length };
  }

  /** 从 planSummary 自动分解模块（页面→模块，短名作 name、原描述作 brief 规格）。MVP 扁平无依赖。 */
  pageItems(planSummary: unknown): { name: string; brief: string }[] {
    const raw = (planSummary as { pages?: unknown })?.pages;
    const list = Array.isArray(raw) ? raw : [];
    const labels = list
      .map((p) => (typeof p === 'string' ? p : (p as { name?: string } | null)?.name || ''))
      .filter(Boolean)
      .slice(0, 6);
    const short = (s: string) => ((s.split(/[—–\-:：(（\s]/)[0].trim() || s).slice(0, 8));
    return (labels.length ? labels : ['总览', '列表']).map((label) => ({ name: short(label), brief: label }));
  }

  private async assertOwner(userId: string, projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) throw new ForbiddenException('无权访问');
  }
}
