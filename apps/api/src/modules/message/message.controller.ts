import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MessageService } from './message.service';
import { SendMessageDto } from '../auth/dto/auth.dto';

@Controller('api/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class MessageController {
  constructor(private messageService: MessageService) {}

  @Get('messages')
  async getMessages(@Req() req: any, @Param('projectId') projectId: string) {
    return this.messageService.getMessages(req.user.id, projectId);
  }

  @Post('messages')
  async sendMessage(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() body: SendMessageDto,
  ) {
    return this.messageService.sendMessage(req.user.id, projectId, body.content);
  }
}
