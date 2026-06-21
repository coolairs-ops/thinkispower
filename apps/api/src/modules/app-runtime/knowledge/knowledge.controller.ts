import { Controller, Get, Post, Body, Param, Req, UseGuards, UseInterceptors, UploadedFile, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../../database/prisma.service';
import { KnowledgeSourceService, UploadedDoc } from './knowledge-source.service';

/**
 * 可溯源知识库端点（接入轨 ②）：上传原件 → 提取候选 → 人工确认。
 * 知识库存 structuredRequirement.knowledgeBase；原件存 MinIO。
 */
@Controller('api/projects/:projectId/knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(
    private prisma: PrismaService,
    private svc: KnowledgeSourceService,
  ) {}

  /** 上传一份原件 → 落 MinIO + 抽文本 + LLM 提取候选 + 机器校验门 → 返候选事实待确认 */
  @Post('sources')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @UploadedFile() file: UploadedDoc | undefined,
    @Body('needFactNames') needFactNames?: string,
  ) {
    await this.requireOwner(req.user.id, projectId);
    if (!file?.buffer) throw new BadRequestException('未收到文件');
    const need = needFactNames ? String(needFactNames).split(',').map((s) => s.trim()).filter(Boolean) : [];
    return this.svc.uploadSource(projectId, file, need);
  }

  /** 知识库全量 + 证据链 */
  @Get()
  async load(@Req() req: any, @Param('projectId') projectId: string) {
    await this.requireOwner(req.user.id, projectId);
    return this.svc.loadWithTrace(projectId);
  }

  /** 人工确认 candidate→confirmed */
  @Post('confirm')
  async confirm(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { factIds: string[] }) {
    await this.requireOwner(req.user.id, projectId);
    if (!Array.isArray(body?.factIds) || !body.factIds.length) throw new BadRequestException('需要 factIds');
    const by = req.user.email || req.user.id;
    return this.svc.confirmFacts(projectId, body.factIds, by, new Date().toISOString());
  }

  /** 人工否决 candidate→rejected */
  @Post('reject')
  async reject(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { factIds: string[] }) {
    await this.requireOwner(req.user.id, projectId);
    if (!Array.isArray(body?.factIds) || !body.factIds.length) throw new BadRequestException('需要 factIds');
    return this.svc.rejectFacts(projectId, body.factIds);
  }

  private async requireOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    return project;
  }
}
