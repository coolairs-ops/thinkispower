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

  /** 分级修复记录列表 */
  @Get('remediations')
  async remediations(@Req() req: any, @Param('projectId') projectId: string) {
    return this.guardian.listRemediations(req.user.id, projectId);
  }

  /** 人工触发应用一条修复（建议/确认级）：快照→修复→重验→劣化回滚 */
  @Post('remediations/:remediationId/apply')
  async applyRemediation(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('remediationId') remediationId: string,
  ) {
    return this.guardian.applyRemediation(req.user.id, projectId, remediationId);
  }
}
