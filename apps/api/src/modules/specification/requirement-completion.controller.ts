import { Controller, Get, Post, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirementCompletionService } from './requirement-completion.service';

/** 需求补全 v2 · 升级A：IR 完备性批判（需求→规格阶段）。 */
@Controller('api/projects/:projectId/requirement/completeness')
@UseGuards(JwtAuthGuard)
export class RequirementCompletionController {
  constructor(private svc: RequirementCompletionService) {}

  /** 跑一次完备性批判，返回整块缺口 */
  @Post()
  async analyze(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.analyze(req.user.id, projectId);
  }

  /** 取已存的完备性缺口 */
  @Get()
  async get(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.get(req.user.id, projectId);
  }
}
