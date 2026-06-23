import { Controller, Get, Post, Param, Req, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../database/prisma.service';
import { CaseReviewService } from './case-review.service';

@UseGuards(JwtAuthGuard)
@Controller('api/projects/:projectId/case-review')
export class CaseReviewController {
  constructor(
    private readonly reviewService: CaseReviewService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getReview(@Req() req: any, @Param('projectId') projectId: string) {
    await this.requireOwner(req.user.id, projectId);
    return this.reviewService.findByProject(projectId);
  }

  @Post('generate')
  async generateReview(@Req() req: any, @Param('projectId') projectId: string) {
    await this.requireOwner(req.user.id, projectId);
    return this.reviewService.generateReview(projectId);
  }

  /** A1 安全洞修复：原端点仅 JwtAuthGuard、无 owner 校验 → 任何登录用户可凭 projectId 越权读/生成他人项目复盘。 */
  private async requireOwner(userId: string, projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) throw new ForbiddenException('无权访问');
  }
}
