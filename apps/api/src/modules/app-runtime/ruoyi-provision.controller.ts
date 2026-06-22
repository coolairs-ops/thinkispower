import { Controller, Post, Get, Body, Param, Req, UseGuards, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../database/prisma.service';
import { AppSpec } from './app-spec.types';
import { RuoyiProvisionService } from './ruoyi-provision.service';

/**
 * 若依全自动 provision 触发/查询（私有化档）。
 * POST：入队即返回 jobId（不阻塞——含分钟级编译/重启）。GET：查 backendRuntime descriptor。
 * 默认从项目 IR 自动组装 AppSpec（适配器①，现有项目一键嫁接若依）；可在 body 传 spec 覆盖。
 * 入队逻辑统一在 RuoyiProvisionService.ensureProvisioned（交付/迭代流程也复用它，见 ADR-0005 接线）。
 */
@Controller('api/projects/:projectId/ruoyi')
@UseGuards(JwtAuthGuard)
export class RuoyiProvisionController {
  constructor(
    private prisma: PrismaService,
    private svc: RuoyiProvisionService,
  ) {}

  @Post('provision')
  async provision(@Req() req: any, @Param('projectId') projectId: string, @Body() body: AppSpec | undefined) {
    await this.requireOwner(req.user.id, projectId);
    if (!this.svc.enabled) throw new BadRequestException('未接入若依实例（缺 RUOYI_BASE_URL/RUOYI_SRC_ROOT）');
    // force：显式 opt-in 总是重置重跑；body 传了 spec 就用，否则从项目 IR 自动组装（适配器①）
    const r = await this.svc.ensureProvisioned(projectId, { userId: req.user.id, spec: body?.entities?.length ? body : undefined, force: true });
    if (r.status === 'no-entities') throw new BadRequestException('项目无可用实体（dataModel 为空）');
    return { queued: r.triggered, jobId: r.jobId, source: body?.entities?.length ? 'body' : 'ir', entities: r.resources };
  }

  /** 指定/取消项目用若依底座（方案页开关，第2层显式意图）。body {use:boolean}。 */
  @Post('designate')
  async designate(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { use?: boolean }) {
    await this.requireOwner(req.user.id, projectId);
    return this.svc.designate(projectId, !!body?.use);
  }

  @Get()
  async status(@Req() req: any, @Param('projectId') projectId: string) {
    const project = await this.requireOwner(req.user.id, projectId);
    return { enabled: this.svc.enabled, backendRuntime: project.backendRuntime ?? null };
  }

  private async requireOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true, backendRuntime: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    return project;
  }
}
