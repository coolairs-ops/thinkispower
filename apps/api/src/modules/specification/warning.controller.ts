import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WarningService } from '../../services/warning.service';

@Controller('api/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class WarningController {
  constructor(private warningService: WarningService) {}

  @Get('warnings')
  async getWarnings(@Req() req: any, @Param('projectId') projectId: string) {
    return this.warningService.analyze(projectId);
  }
}
