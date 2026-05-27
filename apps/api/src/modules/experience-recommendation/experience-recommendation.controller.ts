import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ExperienceRecommendationService } from './experience-recommendation.service';

@UseGuards(JwtAuthGuard)
@Controller('api/projects/:projectId/experience-recommendations')
export class ExperienceRecommendationController {
  constructor(private readonly service: ExperienceRecommendationService) {}

  @Get()
  async getRecommendations(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Post('generate')
  async generateRecommendations(@Param('projectId') projectId: string) {
    return this.service.generateRecommendations(projectId);
  }
}
