import { Controller, Post, Get, Body, Param, Req, UseGuards, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../database/prisma.service';
import { AppSpec } from './app-spec.types';
import { RuoyiProvisionService } from './ruoyi-provision.service';
import { AppSpecAssemblerService } from './app-spec-assembler.service';
import { RUOYI_PROVISION_QUEUE, RUOYI_PROVISION_JOB } from './ruoyi-provision.queue';

/**
 * 若依全自动 provision 触发/查询（私有化档）。
 * POST：入队即返回 jobId（不阻塞——含分钟级编译/重启）。GET：查 backendRuntime descriptor。
 * 默认从项目 IR 自动组装 AppSpec（适配器①，现有项目一键嫁接若依）；可在 body 传 spec 覆盖。
 */
@Controller('api/projects/:projectId/ruoyi')
@UseGuards(JwtAuthGuard)
export class RuoyiProvisionController {
  constructor(
    private prisma: PrismaService,
    private svc: RuoyiProvisionService,
    private assembler: AppSpecAssemblerService,
    @InjectQueue(RUOYI_PROVISION_QUEUE) private queue: Queue,
  ) {}

  @Post('provision')
  async provision(@Req() req: any, @Param('projectId') projectId: string, @Body() body: AppSpec | undefined) {
    const project = await this.requireOwner(req.user.id, projectId);
    if (!this.svc.enabled) throw new BadRequestException('未接入若依实例（缺 RUOYI_BASE_URL/RUOYI_SRC_ROOT）');
    // body 传了 spec 就用；否则从项目 IR 自动组装（嫁接现有项目）
    const spec = body?.entities?.length ? body : await this.assembler.fromProject(req.user.id, projectId);
    if (!spec.entities.length) throw new BadRequestException('项目无可用实体（dataModel 为空）');
    const resources = spec.entities.map((e) => e.table);
    // 重 POST 续跑：保留上次的断点相位（同一 spec 重试时跳过已完成步，不重编译）
    const priorPhase = (project.backendRuntime as { phase?: string } | null)?.phase;
    // 立刻把项目标记为"若依置备中"——流程/前端据此显示进度，且 adapter② 此时仍走路B（status≠ready）
    await this.prisma.project.update({
      where: { id: projectId },
      data: { backendRuntime: { kind: 'ruoyi', status: 'provisioning', resources, schemaName: '', provisionedAt: null, ...(priorPhase ? { phase: priorPhase } : {}) } as never },
    });
    const job = await this.queue.add(
      RUOYI_PROVISION_JOB,
      { projectId, spec },
      { attempts: 1, removeOnComplete: 20, removeOnFail: 50 },
    );
    return { queued: true, jobId: job.id, source: body?.entities?.length ? 'body' : 'ir', entities: resources };
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
