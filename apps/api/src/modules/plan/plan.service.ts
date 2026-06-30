import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PlanGeneratorService } from '../../services/plan-generator.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { DemoService } from '../demo/demo.service';
import { isProjectLocked } from '../../common/utils/project-status';
import {
  buildRequirementUplift,
  mergeRequirementUplift,
  buildPlanSeedFromRequirement,
} from '../specification/requirement-uplift.service';

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
      let structuredRequirement = project.structuredRequirement as any;
      const answers = Array.isArray(structuredRequirement?.ideaInterview?.answers)
        ? structuredRequirement.ideaInterview.answers
        : [];
      if (answers.length > 0) {
        const uplift = buildRequirementUplift(answers, { projectName: project.name });
        structuredRequirement = mergeRequirementUplift(structuredRequirement, uplift, { projectName: project.name });
        await this.prisma.project.update({
          where: { id: projectId },
          data: { structuredRequirement: structuredRequirement as any },
        });
      }

      const userMessages = await this.prisma.projectMessage.findMany({
        where: { projectId, role: 'user' },
        orderBy: { createdAt: 'asc' },
        select: { content: true },
      });

      const plan = await this.planGenerator.generatePlan(
        structuredRequirement,
        [
          ...userMessages.map(m => m.content),
          ...answers.map((a: any) => `${a.question}\n${a.answer}`),
        ],
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

    let plan = project.planSummary as any;
    if (!isProjectLocked(project.status)) {
      let structuredRequirement = project.structuredRequirement as any;
      const answers = Array.isArray(structuredRequirement?.ideaInterview?.answers)
        ? structuredRequirement.ideaInterview.answers
        : [];
      if (answers.length > 0) {
        const uplift = buildRequirementUplift(answers, { projectName: project.name });
        structuredRequirement = mergeRequirementUplift(structuredRequirement, uplift, { projectName: project.name });
      }
      const repaired = this.repairPlanWithRequirement(plan, structuredRequirement);
      if (JSON.stringify(repaired) !== JSON.stringify(plan)) {
        plan = repaired;
        await this.prisma.project.update({
          where: { id: projectId },
          data: { structuredRequirement: structuredRequirement as any, planSummary: plan as any },
        });
      }
    }

    return plan;
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
    let structuredRequirement = project.structuredRequirement as any;
    const answers = Array.isArray(structuredRequirement?.ideaInterview?.answers)
      ? structuredRequirement.ideaInterview.answers
      : [];
    if (answers.length > 0) {
      const uplift = buildRequirementUplift(answers, { projectName: project.name });
      structuredRequirement = mergeRequirementUplift(structuredRequirement, uplift, { projectName: project.name });
    }
    const repairedPlan = this.repairPlanWithRequirement(project.planSummary, structuredRequirement);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: structuredRequirement as any, planSummary: repairedPlan as any },
    });
    this.assertPlanUpliftReady(repairedPlan, structuredRequirement);

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

    // Trigger demo generation asynchronously（plan.service 尚未接 org 维度，orgId 暂传 null；generateDemo 仍做 userId 归属校验）
    this.demoService.generateDemo(userId, null, projectId).catch((err) => {
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

  private repairPlanWithRequirement(planSummary: any, structuredRequirement: any) {
    const seed = buildPlanSeedFromRequirement(structuredRequirement);
    return {
      ...planSummary,
      summary: planSummary?.summary || seed.summary,
      pages: nonEmpty(planSummary?.pages) ? planSummary.pages : seed.pages,
      features: nonEmpty(planSummary?.features) ? planSummary.features : seed.features,
      roles: nonEmpty(planSummary?.roles) ? planSummary.roles : seed.roles,
      dataObjects: nonEmpty(planSummary?.dataObjects) ? planSummary.dataObjects : seed.dataObjects,
      acceptanceChecklist: nonEmpty(planSummary?.acceptanceChecklist) ? planSummary.acceptanceChecklist : seed.acceptanceChecklist,
    };
  }

  private assertPlanUpliftReady(planSummary: any, structuredRequirement: any) {
    const seed = buildPlanSeedFromRequirement({ prd: planSummary });
    const sr = structuredRequirement || {};
    const gaps = [
      seed.roles.length ? '' : '角色',
      seed.features.length ? '' : '功能',
      seed.dataObjects.length ? '' : '数据对象',
      Array.isArray(sr.businessRules) && sr.businessRules.length > 0 ? '' : '业务规则',
      seed.acceptanceChecklist.length ? '' : '验收场景',
    ].filter(Boolean);
    if (gaps.length > 0) {
      throw new BadRequestException(`需求提升未完成，暂不能生成 Demo。还缺：${gaps.join('、')}。请先补齐访谈答案或在方案页编辑后保存。`);
    }
  }
}

function nonEmpty(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}
