import { Controller, Get, Put, Body, Param, UseGuards, Req, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlanService } from './plan.service';
import { DesignAdvisorService, DesignSuggestion } from '../../services/design-advisor.service';
import { PrismaService } from '../../database/prisma.service';

@Controller('api/projects/:projectId/plan')
@UseGuards(JwtAuthGuard)
export class PlanController {
  constructor(
    private planService: PlanService,
    private designAdvisor: DesignAdvisorService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async getPlan(@Req() req: any, @Param('projectId') projectId: string) {
    return this.planService.getPlan(req.user.id, projectId);
  }

  @Put()
  async updatePlan(@Req() req: any, @Param('projectId') projectId: string, @Body() body: any) {
    return this.planService.updatePlan(req.user.id, projectId, body);
  }

  @Put('confirm')
  async confirmPlan(@Req() req: any, @Param('projectId') projectId: string) {
    return this.planService.confirmPlan(req.user.id, projectId);
  }

  @Get('design-suggestions')
  async getDesignSuggestions(@Req() req: any, @Param('projectId') projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== req.user.id) throw new ForbiddenException('无权访问');
    return this.designAdvisor.getOrGenerate(projectId, project.planSummary, project.structuredRequirement);
  }

  @Put('design-suggestions')
  async updateDesignSuggestions(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() body: { suggestions: DesignSuggestion[] },
  ) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== req.user.id) throw new ForbiddenException('无权访问');
    const sr = (project.structuredRequirement as any) || {};
    sr.designSuggestions = body.suggestions;
    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: sr },
    });
    return body.suggestions;
  }
}
