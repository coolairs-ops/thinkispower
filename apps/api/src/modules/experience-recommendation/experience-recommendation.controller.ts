import { Controller, Get, Post, Param, Req, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../database/prisma.service';
import { ExperienceRecommendationService } from './experience-recommendation.service';

@UseGuards(JwtAuthGuard)
@Controller('api/projects/:projectId/experience-recommendations')
export class ExperienceRecommendationController {
  constructor(
    private readonly service: ExperienceRecommendationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getRecommendations(@Req() req: any, @Param('projectId') projectId: string) {
    await this.requireOwner(req.user.id, projectId);
    return this.service.findByProject(projectId);
  }

  @Post('generate')
  async generateRecommendations(@Req() req: any, @Param('projectId') projectId: string) {
    await this.requireOwner(req.user.id, projectId);
    return this.service.generateRecommendations(projectId);
  }

  /** A1 安全洞修复：原端点仅 JwtAuthGuard、无 owner 校验 → 任何登录用户可凭 projectId 越权读/生成他人项目经验推荐。 */
  private async requireOwner(userId: string, projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) throw new ForbiddenException('无权访问');
  }
}
