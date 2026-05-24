import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DemoGeneratorService } from '../../services/demo-generator.service';
import { StatusMapperService } from '../../services/status-mapper.service';

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private prisma: PrismaService,
    private demoGenerator: DemoGeneratorService,
    private statusMapper: StatusMapperService,
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
      select: { id: true, userId: true, status: true, planSummary: true },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const allowedStatuses = ['plan_ready', 'demo_generating', 'demo_ready', 'awaiting_demo_feedback'];
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
    try {
      const html = await this.demoGenerator.generateDemoHtml(planSummary);

      // Validate HTML size
      if (html.length < 100) {
        throw new Error('生成的 HTML 内容过短');
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

      this.logger.log(`演示生成成功 (${projectId}): ${html.length} bytes`);
    } catch (err) {
      this.logger.error(`演示生成失败:`, err);
      // Reset status to plan_ready so user can retry
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'plan_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('plan_ready'),
        },
      });
    }
  }
}
