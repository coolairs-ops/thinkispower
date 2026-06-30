import { Controller, Get, Post, Put, Param, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SpecificationService } from './specification.service';
import { RequirementAssetRebuildService } from './requirement-asset-rebuild.service';
import { UpdateSpecDto, FreezeSpecDto } from './dto/spec.dto';

@Controller('api/projects/:projectId/specification')
@UseGuards(JwtAuthGuard)
export class SpecificationController {
  constructor(
    private specService: SpecificationService,
    private assetRebuild: RequirementAssetRebuildService,
  ) {}

  /** 获取当前规格 */
  @Get()
  async getSpec(@Req() req: any, @Param('projectId') projectId: string) {
    return this.specService.getSpec(req.user.id, req.user.orgId ?? null, projectId);
  }

  /** 自动生成规格草案 */
  @Post('generate')
  async generateDraft(@Req() req: any, @Param('projectId') projectId: string) {
    return this.specService.generateDraft(req.user.id, req.user.orgId ?? null, projectId);
  }

  /** 从 30 问访谈答案重建结构化需求资产、方案和规格草案 */
  @Post('rebuild-from-interview')
  async rebuildFromInterview(@Req() req: any, @Param('projectId') projectId: string): Promise<any> {
    return this.assetRebuild.rebuildFromInterview(req.user.id, req.user.orgId ?? null, projectId);
  }

  /** 更新规格内容 */
  @Put()
  async updateSpec(@Req() req: any, @Param('projectId') projectId: string, @Body() dto: UpdateSpecDto) {
    return this.specService.updateSpec(req.user.id, req.user.orgId ?? null, projectId, dto);
  }

  /** 确认/退回规格 */
  @Post('freeze')
  async freezeSpec(@Req() req: any, @Param('projectId') projectId: string, @Body() dto: FreezeSpecDto) {
    return this.specService.freezeSpec(req.user.id, req.user.orgId ?? null, projectId, dto);
  }
}
