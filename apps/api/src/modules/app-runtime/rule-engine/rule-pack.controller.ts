import { Controller, Get, Put, Post, Body, Param, Req, UseGuards, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../../database/prisma.service';
import { RuleEngineService } from './rule-engine.service';
import { RulePack, RuleDataContext } from './rule-pack.types';

/**
 * 规则包配置态端点（Slice 1）：存/取规则包 + **即时试算**（命根子）。
 * 即时试算 = 对一份草稿规则包 + 一个样例案例**当场跑引擎**（不读 DB、不需真实数据），
 * 让业务专家"改个阈值/权重立刻看结论变"，像 Excel。规则包存 structuredRequirement.rulePack。
 */
@Controller('api/projects/:projectId/rule-pack')
@UseGuards(JwtAuthGuard)
export class RulePackController {
  constructor(
    private prisma: PrismaService,
    private engine: RuleEngineService,
  ) {}

  /** 取当前规则包（无则返 null，前端用行业模板起手） */
  @Get()
  async load(@Req() req: any, @Param('projectId') projectId: string) {
    await this.requireOwner(req.user.id, projectId);
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { structuredRequirement: true } });
    const sr = (p?.structuredRequirement ?? {}) as Record<string, unknown>;
    return { rulePack: (sr.rulePack as RulePack | undefined) ?? null };
  }

  /** 保存规则包（写 structuredRequirement.rulePack，不动其它键） */
  @Put()
  async save(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { rulePack: RulePack }) {
    await this.requireOwner(req.user.id, projectId);
    if (!body?.rulePack?.meta) throw new BadRequestException('rulePack.meta 缺失');
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { structuredRequirement: true } });
    const sr = (p?.structuredRequirement ?? {}) as Record<string, unknown>;
    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: { ...sr, rulePack: body.rulePack } as never },
    });
    return { saved: true, version: body.rulePack.meta.version };
  }

  /** 即时试算：对草稿规则包 + 样例案例当场跑引擎，返结论/分数/证据（不持久、不读DB） */
  @Post('trial')
  async trial(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { rulePack: RulePack; sample: RuleDataContext; now?: string }) {
    await this.requireOwner(req.user.id, projectId);
    if (!body?.rulePack || !body?.sample) throw new BadRequestException('需要 rulePack 与 sample');
    return this.engine.evaluate(body.rulePack, body.sample, body.now);
  }

  private async requireOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    return project;
  }
}
