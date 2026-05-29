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
      select: { id: true, userId: true, status: true, publicStatusLabel: true, demoUrl: true, demoHtml: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    const ready = ['demo_ready', 'awaiting_demo_feedback', 'developing', 'completed'];
    return { status: project.status, publicStatusLabel: project.publicStatusLabel, demoUrl: project.demoUrl, html: ready.includes(project.status) ? project.demoHtml : null };
  }

  async generateDemo(userId: string, projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, userId: true, status: true, planSummary: true } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) throw new ForbiddenException('无权访问');
    return this.doGenerate(p);
  }

  async generateDemoInternal(projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, status: true, planSummary: true } });
    if (!p) throw new NotFoundException('项目不存在');
    return this.doGenerate(p);
  }

  private async doGenerate(p: { id: string; status: string; planSummary: any }) {
    const allowed = ['prd_ready', 'plan_ready', 'demo_generating', 'demo_ready', 'awaiting_demo_feedback'];
    if (!allowed.includes(p.status)) throw new BadRequestException('当前状态不允许');
    if (!p.planSummary) throw new BadRequestException('方案尚未生成');

    await this.prisma.project.update({ where: { id: p.id }, data: { status: 'demo_generating', publicStatusLabel: '正在生成预览' } });
    this.generateAsync(p.id, p.planSummary).catch(err => this.logger.error(`Demo失败:`, err));
    return { status: 'demo_generating', message: '预览正在生成中...' };
  }

  private async generateAsync(projectId: string, planSummary: any) {
    try {
      // N8N 优先
      const n8nOk = await this.n8n.triggerDemoGenerateWorkflow(projectId);
      if (n8nOk.success) { this.logger.log(`N8N触发(${projectId})`); return; }

      // Pipeline 降级
      this.logger.warn(`N8N不可用,Pipeline(${projectId})`);
      await this.prisma.task.create({ data: { projectId, type: 'frontend', title: 'Demo预览', description: `生成Demo HTML。\n${planSummary.summary||''}\n页面:${(planSummary.pages||[]).join('、')}`, priority: 100, status: 'pending', inputPayload: { planSummary, source: 'demo_generate' } } });
      this.eventEmitter.emit(EVENTS.TASKS_CREATED, { projectId, taskIds: [] } as TasksCreatedPayload);
    } catch (err) { this.logger.error(`异常(${projectId}):`, err); }
  }
}
