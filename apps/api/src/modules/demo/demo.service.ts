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
    let lastImprovements: string | undefined = undefined;
    const MAX_RETRIES = 2;

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

        // 所有重试均失败，重置状态
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
}
