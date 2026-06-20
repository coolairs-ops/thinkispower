import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FollowUpQuestionService } from './followup-question.service';

/** 追加问答合批（D 的 ask 缺口 + 关系 ask 候选，一个窗口一次答完）。 */
@Controller('api/projects/:projectId/requirement/followup')
@UseGuards(JwtAuthGuard)
export class FollowUpQuestionController {
  constructor(private svc: FollowUpQuestionService) {}

  /** 取合批问题列表（空 → 前端不弹窗） */
  @Get()
  async questions(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.getQuestions(req.user.id, projectId);
  }

  /** 提交答案：relations 答案路由关系 apply、acceptGaps 路由需求 apply */
  @Post()
  async submit(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() body: { relations?: Record<string, { cardinality?: string; onDelete?: string; required?: boolean }>; acceptGaps?: string[] },
  ) {
    return this.svc.submit(req.user.id, projectId, body ?? {});
  }
}
