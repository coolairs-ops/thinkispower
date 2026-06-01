import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DecisionEngineService } from '../../services/decision-engine.service';

@Controller('api/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class DecisionController {
  constructor(private decisionEngine: DecisionEngineService) {}

  @Get('next-step')
  async getNextStep(@Req() req: any, @Param('projectId') projectId: string) {
    return this.decisionEngine.evaluate(projectId);
  }
}
