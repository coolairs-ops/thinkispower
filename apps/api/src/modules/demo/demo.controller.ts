import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DemoService } from './demo.service';

@Controller('api/projects/:projectId/demo')
@UseGuards(JwtAuthGuard)
export class DemoController {
  constructor(private demoService: DemoService) {}

  @Get()
  async getDemo(@Req() req: any, @Param('projectId') projectId: string) {
    return this.demoService.getDemo(req.user.id, projectId);
  }

  @Post('generate')
  async generateDemo(@Req() req: any, @Param('projectId') projectId: string) {
    return this.demoService.generateDemo(req.user.id, projectId);
  }

  /** 保存预览里直接编辑后的 HTML（档位调整等局部修改） */
  @Patch('html')
  async saveEditedHtml(@Req() req: any, @Param('projectId') projectId: string, @Body('html') html: string) {
    return this.demoService.saveEditedHtml(req.user.id, projectId, html);
  }

  /** 保存 demo 外观主题（Phase A 换肤：主色/明暗/圆角） */
  @Patch('theme')
  async saveTheme(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() body: { primary?: string; mode?: 'light' | 'dark'; radius?: number },
  ) {
    return this.demoService.saveTheme(req.user.id, projectId, body);
  }
}
