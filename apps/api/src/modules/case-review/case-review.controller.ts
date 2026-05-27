import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CaseReviewService } from './case-review.service';

@UseGuards(JwtAuthGuard)
@Controller('api/projects/:projectId/case-review')
export class CaseReviewController {
  constructor(private readonly reviewService: CaseReviewService) {}

  @Get()
  async getReview(@Param('projectId') projectId: string) {
    return this.reviewService.findByProject(projectId);
  }

  @Post('generate')
  async generateReview(@Param('projectId') projectId: string) {
    return this.reviewService.generateReview(projectId);
  }
}
