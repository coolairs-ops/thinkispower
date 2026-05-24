import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DemoService } from './demo.service';

@Controller('api/projects/:projectId/demo')
@UseGuards(JwtAuthGuard)
export class DemoController {
  constructor(private demoService: DemoService) {}

  @Get()
  async getDemo(@Req() req: any, @Param('projectId') projectId: string) {
    return this.demoService.getDemo(req.user.id, projectId);
  }

  @Post('generate')
  async generateDemo(@Req() req: any, @Param('projectId') projectId: string) {
    return this.demoService.generateDemo(req.user.id, projectId);
  }
}
