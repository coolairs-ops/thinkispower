import { Controller, Get, Param, Req, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../../database/prisma.service';
import { RuleEvaluationService } from './rule-evaluation.service';

/**
 * 规则评估端点（Slice 0.5）：查一个对象 → 跑该项目规则包 → 返结论 + 证据链 + 数据来源。
 * 引擎读真实 CRUD 数据（契约A），规则包存 structuredRequirement.rulePack。
 */
@Controller('api/projects/:projectId/rule-eval')
@UseGuards(JwtAuthGuard)
export class RuleEvalController {
  constructor(
    private prisma: PrismaService,
    private svc: RuleEvaluationService,
  ) {}

  /** GET /api/projects/:projectId/rule-eval/:resource/:objectId */
  @Get(':resource/:objectId')
  async evaluate(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('resource') resource: string,
    @Param('objectId') objectId: string,
  ) {
    await this.requireOwner(req.user.id, projectId);
    return this.svc.evaluateObject(projectId, resource, objectId);
  }

  private async requireOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    return project;
  }
}
