import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PlanGeneratorService } from '../../services/plan-generator.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { DemoService } from '../demo/demo.service';
import { isProjectLocked } from '../../common/utils/project-status';

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    private prisma: PrismaService,
    private planGenerator: PlanGeneratorService,
    private statusMapper: StatusMapperService,
    private demoService: DemoService,
  ) {}

  async getPlan(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    if (!project.structuredRequirement) {
      return null;
    }

    // Generate plan if not already generated
    if (!project.planSummary) {
      const userMessages = await this.prisma.projectMessage.findMany({
        where: { projectId, role: 'user' },
        orderBy: { createdAt: 'asc' },
        select: { content: true },
      });

      const plan = await this.planGenerator.generatePlan(
        project.structuredRequirement,
        userMessages.map(m => m.content),
      );

      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          planSummary: plan as any,
          status: 'plan_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('plan_ready'),
        },
      });

      return plan;
    }

    return project.planSummary as any;
  }

  async confirmPlan(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    if (!project.planSummary) throw new BadRequestException('方案尚未生成，请先完成需求描述');
    // 终态保护：已进入开发/交付的项目不应被「确认方案」打回 demo 生成（避免丢弃已有成果重做）
    if (isProjectLocked(project.status)) {
      throw new BadRequestException('项目已进入开发/交付阶段，如需修改请使用迭代功能');
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'demo_generating',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_generating'),
      },
    });

    // Save confirmation message
    await this.prisma.projectMessage.create({
      data: {
        projectId,
        role: 'assistant',
        content: '方案已确认，正在生成预览页面。',
      },
    });

    // Trigger demo generation asynchronously
    this.demoService.generateDemo(userId, projectId).catch((err) => {
      this.logger.error(`Failed to auto-generate demo after plan confirm: ${err.message}`);
    });

    return { success: true, status: 'demo_generating' };
  }

  async updatePlan(userId: string, projectId: string, planData: any) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    // Merge with existing plan or replace
    const existingPlan = (project.planSummary as any) || {};
    const updatedPlan = { ...existingPlan, ...planData };

    await this.prisma.project.update({
      where: { id: projectId },
      data: { planSummary: updatedPlan as any },
    });

    return updatedPlan;
  }
}
