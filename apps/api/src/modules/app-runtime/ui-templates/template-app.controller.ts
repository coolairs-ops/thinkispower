import { Controller, Post, Put, Get, Body, Param, Req, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../../database/prisma.service';
import { TemplateAppService } from './template-app.service';
import { listThemes } from './theme-tokens';

/**
 * 模板出页端点：用内置模板（选主题+套页型+填数据）生成 demoHtml，替代 DeepSeek 即兴。
 */
@Controller('api/projects/:projectId/demo')
@UseGuards(JwtAuthGuard)
export class TemplateAppController {
  constructor(
    private prisma: PrismaService,
    private svc: TemplateAppService,
  ) {}

  /** 可选主题列表（选皮肤 UI 用） */
  @Get('themes')
  async themes(@Req() req: any, @Param('projectId') projectId: string) {
    await this.requireOwner(req.user.id, projectId);
    return { themes: listThemes() };
  }

  /** 用模板出页：body { themeId? } */
  @Post('from-template')
  async fromTemplate(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { themeId?: string }) {
    await this.requireOwner(req.user.id, projectId);
    return this.svc.buildAndStore(projectId, body?.themeId);
  }

  /** 后台管理控制台预览（按需渲染，返 html；前端 blob 打开）。 */
  @Get('admin')
  async admin(@Req() req: any, @Param('projectId') projectId: string) {
    await this.requireOwner(req.user.id, projectId);
    return { html: await this.svc.renderAdmin(projectId) };
  }

  /** 读页面 schema + 可绑数据契约（编辑面板 S4：bind 只能从契约选）。 */
  @Get('app-schema')
  async getSchema(@Req() req: any, @Param('projectId') projectId: string) {
    await this.requireOwner(req.user.id, projectId);
    return this.svc.getAppSchema(projectId);
  }

  /** 保存编辑后的 schema：校验门 + 重渲染 demoHtml + 落库。body { schema }。 */
  @Put('app-schema')
  async putSchema(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { schema: unknown }) {
    await this.requireOwner(req.user.id, projectId);
    return this.svc.saveAppSchema(projectId, body?.schema);
  }

  private async requireOwner(userId: string, projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) throw new ForbiddenException('无权访问');
    return p;
  }
}
