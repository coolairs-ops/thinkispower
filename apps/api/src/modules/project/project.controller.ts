import { Controller, Get, Post, Patch, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectService } from './project.service';

@Controller('api/projects')
@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(private projectService: ProjectService) {}

  @Post()
  async create(@Req() req: any, @Body() body: { name: string; description?: string }) {
    return this.projectService.create(req.user.id, body);
  }

  @Get()
  async findAll(@Req() req: any) {
    return this.projectService.findAll(req.user.id);
  }

  @Get(':projectId')
  async findOne(@Req() req: any, @Param('projectId') projectId: string) {
    return this.projectService.findOne(req.user.id, projectId);
  }

  @Patch(':projectId')
  async update(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { name?: string; description?: string; appType?: string }) {
    return this.projectService.update(req.user.id, projectId, body);
  }
}
