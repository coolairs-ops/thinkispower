import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DemoGeneratorService } from '../../services/demo-generator.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { DemoSnapshotService } from '../demo-snapshot/demo-snapshot.service';

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private prisma: PrismaService,
    private demoGenerator: DemoGeneratorService,
    private statusMapper: StatusMapperService,
    private demoSnapshotService: DemoSnapshotService,
  ) {}

  async getDemo(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        userId: true,
        status: true,
        publicStatusLabel: true,
        demoUrl: true,
        demoHtml: true,
      },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const readyStatuses = ['demo_ready', 'awaiting_demo_feedback', 'developing', 'completed'];
    const isReady = readyStatuses.includes(project.status);

    return {
      status: project.status,
      publicStatusLabel: project.publicStatusLabel,
      demoUrl: project.demoUrl,
      html: isReady ? project.demoHtml : null,
    };
  }

  async generateDemo(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, status: true, planSummary: true, structuredRequirement: true },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const allowedStatuses = ['prd_ready', 'plan_ready', 'demo_generating', 'demo_ready', 'awaiting_demo_feedback'];
    if (!allowedStatuses.includes(project.status)) {
      throw new BadRequestException(`当前状态(${project.status})不允许生成预览`);
    }

    if (!project.planSummary) {
      throw new BadRequestException('方案尚未生成，请先完成需求描述');
    }

    // Update status to generating
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'demo_generating',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_generating'),
      },
    });

    // Generate HTML async
    this.generateDemoAsync(projectId, project.planSummary as any).catch((err) => {
      this.logger.error(`演示生成失败 (${projectId}):`, err);
    });

    return { status: 'demo_generating', message: '预览正在生成中...' };
  }

  private async generateDemoAsync(projectId: string, planSummary: any) {
    let lastImprovements: string | undefined = undefined;
    const MAX_RETRIES = 1; // 减少重试，API 失败时快速降级

    // 直接生成基础 HTML 作为最终降级
    const fallbackToBasicHtml = async () => {
      const basicHtml = this.buildBasicDemoHtml(planSummary);
      const existing = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { demoHtml: true },
      });
      if (existing?.demoHtml) {
        await this.demoSnapshotService.createSnapshot(projectId, existing.demoHtml, 'demo_generate');
      }
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          demoHtml: basicHtml,
          demoUrl: `/demo/${projectId}`,
          status: 'demo_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_ready'),
        },
      });
      this.logger.log(`演示降级成功 (${projectId}): 基础模板 ${basicHtml.length} bytes`);
    };

    // 超时保护：30 秒后强制降级
    const timeout = setTimeout(() => {
      this.logger.warn(`Demo 生成超时 (${projectId})，使用基础模板`);
      fallbackToBasicHtml();
    }, 45_000);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const html = await this.demoGenerator.generateDemoHtml(planSummary, lastImprovements);

        // Validate HTML size
        if (html.length < 100) {
          throw new Error('生成的 HTML 内容过短');
        }

        // 质量门禁：评估 Demo 质量
        const evaluation = await this.demoGenerator.evaluateDemo(html, planSummary);
        this.logger.log(`Demo 质量评估: ${evaluation.score}分 (第 ${attempt + 1} 次生成)`);

        if (evaluation.score < 60 && attempt < MAX_RETRIES) {
          lastImprovements = `质量评分 ${evaluation.score}/100，以下方面需要改进：\n${evaluation.missingItems.map((i) => `- ${i}`).join('\n')}\n${evaluation.details}`;
          this.logger.log(`Demo 质量不足(${evaluation.score}分)，重新生成 (${attempt + 1}/${MAX_RETRIES})`);
          continue;
        }

        if (evaluation.score < 60) {
          this.logger.warn(`Demo 质量评分 ${evaluation.score}，但已超过最大重试次数`);
        }

        clearTimeout(timeout); // 成功生成，取消超时降级

        // 保存当前 demoHtml 快照（如果已存在）
        const existing = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { demoHtml: true },
        });
        if (existing?.demoHtml) {
          await this.demoSnapshotService.createSnapshot(
            projectId,
            existing.demoHtml,
            'demo_generate',
          );
        }

        await this.prisma.project.update({
          where: { id: projectId },
          data: {
            demoHtml: html,
            demoUrl: `/demo/${projectId}`,
            status: 'demo_ready',
            publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_ready'),
          },
        });

        this.logger.log(`演示生成成功 (${projectId}): ${html.length} bytes, 评分 ${evaluation.score}`);
        return; // 成功退出
      } catch (err) {
        this.logger.error(`演示生成失败 (尝试 ${attempt + 1}/${MAX_RETRIES + 1}):`, err);

        if (attempt < MAX_RETRIES) {
          lastImprovements = `生成过程出错，请确保输出完整的 HTML 文档：${(err as Error).message}`;
          continue;
        }

        // 所有重试均失败 → 生成基础 HTML 模板降级，而非完全重置
        this.logger.warn(`AI 生成失败，使用基础模板降级 (${projectId})`);
        const basicHtml = this.buildBasicDemoHtml(planSummary);
        await this.demoSnapshotService.createSnapshot(projectId, basicHtml, 'demo_generate');
        await this.prisma.project.update({
          where: { id: projectId },
          data: {
            demoHtml: basicHtml,
            demoUrl: `/demo/${projectId}`,
            status: 'demo_ready',
            publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_ready'),
          },
        });
        this.logger.log(`演示降级成功 (${projectId}): 基础模板 ${basicHtml.length} bytes`);
        return;
      }
    }
  }

  /**
   * 当 AI 生成失败时，基于 planSummary 生成一个基础管理面板 HTML 模板。
   */
  private buildBasicDemoHtml(planSummary: any): string {
    const plan = typeof planSummary === 'object' && planSummary ? planSummary : {};
    const pages: string[] = Array.isArray(plan.pages) ? plan.pages : ['首页', '列表页'];
    const features: string[] = Array.isArray(plan.features) ? plan.features : [];
    const name = plan.summary || '应用';

    const navItems = pages.map((p, i) => {
      const key = `page-${i}`;
      return `        <a class="nav-item" data-route="${key}" onclick="navigate('${key}')">${p}</a>`;
    }).join('\n');

    const pageRenders = pages.map((p, i) => {
      const key = `page-${i}`;
      const featureCards = features.map((f, fi) =>
        `            <div class="card" data-module-key="${key}" data-element-path="feature-${fi}"><h3>${f}</h3><p class="text-gray-500 text-sm mt-1">点击此处进行操作</p></div>`
      ).join('\n');
      return `      '${key}': { render: function() { return \`<h2 data-module-key="${key}" data-element-path="title">${p}</h2><div class="card-grid">${featureCards}</div>\`; }, name: '${p}' }`;
    }).join(',\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; min-height: 100vh; background: #f5f7fa; color: #333; }
  .sidebar { width: 220px; background: #1e293b; color: #fff; padding: 20px 0; }
  .sidebar h1 { padding: 0 20px 20px; font-size: 16px; border-bottom: 1px solid #334155; }
  .nav { padding: 10px 0; }
  .nav-item { display: block; padding: 10px 20px; color: #94a3b8; cursor: pointer; text-decoration: none; font-size: 14px; transition: all .2s; }
  .nav-item:hover { background: #334155; color: #fff; }
  .nav-item.active { background: #3b82f6; color: #fff; }
  .main { flex: 1; padding: 30px; }
  .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; margin-top: 20px; }
  .card { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.1); cursor: pointer; transition: box-shadow .2s; }
  .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.15); }
  .text-gray-500 { color: #6b7280; }
  .text-sm { font-size: 13px; }
  .mt-1 { margin-top: 4px; }
  .annotation-highlight { outline: 3px solid #3b82f6; outline-offset: 2px; background: rgba(59,130,246,.08); border-radius: 4px; }
</style>
</head>
<body>
  <div class="sidebar">
    <h1>${name}</h1>
    <div class="nav">
${navItems}
    </div>
  </div>
  <div class="main" id="main-content"></div>
  <script>
    var pages = { ${pageRenders} };
    function navigate(key) {
      var page = pages[key];
      if (page) {
        document.getElementById('main-content').innerHTML = page.render();
        document.querySelectorAll('.nav-item').forEach(function(el) {
          el.classList.toggle('active', el.getAttribute('data-route') === key);
        });
      }
    }
    document.addEventListener('click', function(e) {
      var el = e.target.closest('[data-module-key]');
      if (el) {
        window.parent.postMessage({ type: 'element-click', moduleKey: el.getAttribute('data-module-key'), elementPath: el.getAttribute('data-element-path') || '' }, '*');
      }
    });
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'highlight-element') {
        document.querySelectorAll('.annotation-highlight').forEach(function(el) { el.classList.remove('annotation-highlight'); });
        var sel = '[data-module-key="' + e.data.moduleKey + '"]';
        if (e.data.elementPath) sel += '[data-element-path="' + e.data.elementPath + '"]';
        var t = document.querySelector(sel);
        if (t) { t.classList.add('annotation-highlight'); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      } else if (e.data && e.data.type === 'clear-highlight') {
        document.querySelectorAll('.annotation-highlight').forEach(function(el) { el.classList.remove('annotation-highlight'); });
      }
    });
    navigate(Object.keys(pages)[0]);
  </script>
</body>
</html>`;
  }
}
