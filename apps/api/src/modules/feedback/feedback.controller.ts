import { Controller, Get, Post, Patch, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto, UpdateFeedbackStatusDto } from '../auth/dto/auth.dto';

@Controller('api/projects/:projectId/feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private feedbackService: FeedbackService) {}

  @Get()
  async findAll(@Req() req: any, @Param('projectId') projectId: string) {
    return this.feedbackService.findAll(req.user.id, projectId);
  }

  @Post()
  async create(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() body: CreateFeedbackDto,
  ) {
    return this.feedbackService.create(req.user.id, projectId, body);
  }

  @Patch(':feedbackId')
  async updateStatus(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('feedbackId') feedbackId: string,
    @Body() body: UpdateFeedbackStatusDto,
  ) {
    return this.feedbackService.updateStatus(req.user.id, projectId, feedbackId, body.status!);
  }
}
