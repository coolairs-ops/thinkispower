import { Controller, Get, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { IdeaInterviewService } from './idea-interview.service';

@Controller('api/projects/:projectId/idea')
@UseGuards(JwtAuthGuard)
export class IdeaInterviewController {
  constructor(private ideaService: IdeaInterviewService) {}

  @Get()
  async getState(@Req() req: any, @Param('projectId') projectId: string) {
    return this.ideaService.getState(projectId);
  }

  @Post('answer')
  async answer(@Req() req: any, @Param('projectId') projectId: string, @Body('answer') answer: string) {
    if (!answer || answer.trim().length === 0) {
      return { error: '请输入回答' };
    }
    return this.ideaService.answer(projectId, answer.trim());
  }
}
