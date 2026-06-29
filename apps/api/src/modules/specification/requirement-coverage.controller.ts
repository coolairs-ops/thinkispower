import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirementCoverageService } from './requirement-coverage.service';

/** 需求覆盖度（ADR-0016 切片2）：若依交付覆盖度 + followup 选择题，喂需求页进度条/缺口清单。 */
@Controller('api/projects/:projectId/coverage')
@UseGuards(JwtAuthGuard)
export class RequirementCoverageController {
  constructor(private svc: RequirementCoverageService) {}

  /** 取覆盖度 + 缺口 + 业务选择题 */
  @Get()
  async coverage(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.getCoverage(req.user.id, req.user.orgId ?? null, projectId);
  }
}
