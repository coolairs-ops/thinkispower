import { Controller, Get, Post, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GuardianService } from './guardian.service';

@Controller('api/projects/:projectId/guardian')
@UseGuards(JwtAuthGuard)
export class GuardianController {
  constructor(private guardian: GuardianService) {}

  /** 守护状态：是否入列、最新健康快照、近 20 条历史 */
  @Get()
  async getStatus(@Req() req: any, @Param('projectId') projectId: string) {
    return this.guardian.getStatus(req.user.id, projectId);
  }

  /** 手动触发一次巡检（异步入队） */
  @Post('check')
  async check(@Req() req: any, @Param('projectId') projectId: string) {
    return this.guardian.manualCheck(req.user.id, projectId);
  }
}
