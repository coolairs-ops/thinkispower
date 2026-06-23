import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
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
    return this.svc.analyze(req.user.id, req.user.orgId ?? null, projectId);
  }

  /** 取已存的完备性缺口 */
  @Get()
  async get(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.get(req.user.id, req.user.orgId ?? null, projectId);
  }

  /** 升级D：对已存缺口做处置分类（autofill/ask/info），富集回缺口并返回 */
  @Post('disposition')
  async classify(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.classify(req.user.id, req.user.orgId ?? null, projectId);
  }

  /** 升级E 回写：把采纳的 screen 缺口写进 planSummary.pages（accept=用户显式选中的 missing 列表） */
  @Post('apply')
  async apply(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { accept?: string[] }) {
    return this.svc.apply(req.user.id, req.user.orgId ?? null, projectId, body?.accept ?? []);
  }
}
