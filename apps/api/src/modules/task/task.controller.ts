import { Controller, Get, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TaskService } from './task.service';
import { UpdateTaskDto } from './dto/update-task.dto';

@Controller('api')
@UseGuards(JwtAuthGuard)
export class TaskController {
  constructor(private taskService: TaskService) {}

  @Get('projects/:projectId/tasks')
  async findByProject(@Req() req: any, @Param('projectId') projectId: string) {
    return this.taskService.findByProject(projectId);
  }

  @Patch('tasks/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTaskDto,
  ) {
    return this.taskService.updateStatus(id, body.status!, {
      resultPayload: body.resultPayload,
      errorMessage: body.errorMessage,
    });
  }
}
