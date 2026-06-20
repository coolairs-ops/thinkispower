import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RelationCompletionService } from './relation-completion.service';

/** 实体关系补全（relationship-completion-design.md，Phase 2a）。 */
@Controller('api/projects/:projectId/requirement/relations')
@UseGuards(JwtAuthGuard)
export class RelationCompletionController {
  constructor(private svc: RelationCompletionService) {}

  /** 检测候选关系（出选择题） */
  @Post('detect')
  async detect(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.detect(req.user.id, projectId);
  }

  /** 取已存候选 + 已确定关系 */
  @Get()
  async get(@Req() req: any, @Param('projectId') projectId: string) {
    return this.svc.get(req.user.id, projectId);
  }

  /** 回写：autofill + 客户对 ask 的答案 → 确定关系（answers 键 = `${parent}->${child}`） */
  @Post('apply')
  async apply(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() body: { answers?: Record<string, { cardinality?: string; onDelete?: string; required?: boolean }> },
  ) {
    return this.svc.apply(req.user.id, projectId, body?.answers ?? {});
  }
}
