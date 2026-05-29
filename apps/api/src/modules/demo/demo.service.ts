import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { DemoSnapshotService } from '../demo-snapshot/demo-snapshot.service';
import { N8nClient } from '../../integrations/n8n/n8n.client';
import { EVENTS, TasksCreatedPayload } from '../../events/event-types';

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
    private demoSnapshotService: DemoSnapshotService,
    private n8n: N8nClient,
    private eventEmitter: EventEmitter2,
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
    // 超时降级保底（60s）
    const fallbackTimer = setTimeout(async () => {
      this.logger.warn(`Demo 生成超时 (${projectId})，使用基础模板`);
      const basicHtml = this.buildBasicDemoHtml(planSummary);
      const existing = await this.prisma.project.findUnique({
        where: { id: projectId }, select: { demoHtml: true },
      });
      if (existing?.demoHtml) {
        await this.demoSnapshotService.createSnapshot(projectId, existing.demoHtml, 'demo_generate');
      }
      await this.prisma.project.update({
        where: { id: projectId },
        data: { demoHtml: basicHtml, demoUrl: `/demo/${projectId}`, status: 'demo_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_ready') },
      });
      this.logger.log(`演示降级成功 (${projectId}): 基础模板 ${basicHtml.length} bytes`);
    }, 60_000);

    try {
      // 优先触发 N8N 工作流编排
      const n8nResult = await this.n8n.triggerDemoGenerateWorkflow(projectId);
      if (n8nResult.success) {
        this.logger.log(`N8N demo-generate workflow triggered (${projectId})`);
        clearTimeout(fallbackTimer);
        return;
      }

      // N8N 不可用 → 降级：创建 Task → Pipeline → Cloudecode
      this.logger.warn(`N8N unavailable, falling back to Pipeline for demo ${projectId}`);
      const task = await this.prisma.task.create({
        data: {
          projectId,
          type: 'frontend',
          title: '生成 Demo 预览',
          description: `根据方案生成完整的 Demo HTML 预览页面。\n方案摘要：${planSummary.summary || '软件项目'}\n页面：${(planSummary.pages || []).join('、')}`,
          priority: 100,
          status: 'pending',
          inputPayload: { planSummary, source: 'demo_generate' },
        },
      });
      this.eventEmitter.emit(EVENTS.TASKS_CREATED, {
        projectId, taskIds: [task.id],
      } as TasksCreatedPayload);
      this.logger.log(`Demo 降级 Pipeline 已提交 (${projectId})`, task.id);
      clearTimeout(fallbackTimer);
    } catch (err) {
      this.logger.error(`Demo 生成失败 (${projectId}):`, err);
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
