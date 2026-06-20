import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BusinessRuleCompletionService } from './business-rule-completion.service';

/** 业务规则补全（A 抽取 + B 问答）。 */
@Controller('api/projects/:projectId/requirement/business-rules')
@UseGuards(JwtAuthGuard)
export class BusinessRuleCompletionController {
  constructor(private svc: BusinessRuleCompletionService) {}

  /** 检测候选业务规则（清楚的 autofill / 模糊的 ask 出选择题） */
  @Post('detect')
  async detect(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.detect(req.user.id, projectId);
  }

  /** 取已存候选 + 已确定规则 */
  @Get()
  async get(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.get(req.user.id, projectId);
  }

  /** 回写：autofill + 客户对 ask 的答案（键=规则名，值=选定 outcome；'__skip__'=不要） */
  @Post('apply')
  async apply(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { answers?: Record<string, string> }) {
    return this.svc.apply(req.user.id, projectId, body?.answers ?? {});
  }
}
