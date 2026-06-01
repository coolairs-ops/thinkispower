import { Controller, Get, Post, Put, Param, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SpecificationService } from './specification.service';
import { UpdateSpecDto, FreezeSpecDto } from './dto/spec.dto';

@Controller('api/projects/:projectId/specification')
@UseGuards(JwtAuthGuard)
export class SpecificationController {
  constructor(private specService: SpecificationService) {}

  /** 获取当前规格 */
  @Get()
  async getSpec(@Req() req: any, @Param('projectId') projectId: string) {
    return this.specService.getSpec(req.user.id, projectId);
  }

  /** 自动生成规格草案 */
  @Post('generate')
  async generateDraft(@Req() req: any, @Param('projectId') projectId: string) {
    return this.specService.generateDraft(req.user.id, projectId);
  }

  /** 更新规格内容 */
  @Put()
  async updateSpec(@Req() req: any, @Param('projectId') projectId: string, @Body() dto: UpdateSpecDto) {
    return this.specService.updateSpec(req.user.id, projectId, dto);
  }

  /** 确认/退回规格 */
  @Post('freeze')
  async freezeSpec(@Req() req: any, @Param('projectId') projectId: string, @Body() dto: FreezeSpecDto) {
    return this.specService.freezeSpec(req.user.id, projectId, dto);
  }
}
