import { Controller, Get, Put, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlanService } from './plan.service';

@Controller('api/projects/:projectId/plan')
@UseGuards(JwtAuthGuard)
export class PlanController {
  constructor(private planService: PlanService) {}

  @Get()
  async getPlan(@Req() req: any, @Param('projectId') projectId: string) {
    return this.planService.getPlan(req.user.id, projectId);
  }

  @Put()
  async updatePlan(@Req() req: any, @Param('projectId') projectId: string, @Body() body: any) {
    return this.planService.updatePlan(req.user.id, projectId, body);
  }

  @Put('confirm')
  async confirmPlan(@Req() req: any, @Param('projectId') projectId: string) {
    return this.planService.confirmPlan(req.user.id, projectId);
  }
}
