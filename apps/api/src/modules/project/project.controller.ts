import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectService } from './project.service';
import { DeliveryService } from '../delivery/delivery.service';

@Controller('api/projects')
@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(
    private projectService: ProjectService,
    private deliveryService: DeliveryService,
  ) {}

  @Post()
  async create(@Req() req: any, @Body() body: { name: string; description?: string }) {
    return this.projectService.create(req.user.id, req.user.orgId ?? null, body);
  }

  @Get()
  async findAll(@Req() req: any) {
    return this.projectService.findAll(req.user.id, req.user.orgId ?? null);
  }

  @Get(':projectId')
  async findOne(@Req() req: any, @Param('projectId') projectId: string) {
    return this.projectService.findOne(req.user.id, req.user.orgId ?? null, projectId);
  }

  @Patch(':projectId')
  async update(@Req() req: any, @Param('projectId') projectId: string, @Body() body: { name?: string; description?: string; appType?: string; structuredRequirement?: any }) {
    return this.projectService.update(req.user.id, req.user.orgId ?? null, projectId, body);
  }

  @Delete(':projectId')
  async remove(@Req() req: any, @Param('projectId') projectId: string) {
    await this.projectService.remove(req.user.id, req.user.orgId ?? null, projectId);
    return { success: true };
  }

  @Post(':projectId/confirm-plan')
  async confirmPlan(@Req() req: any, @Param('projectId') projectId: string) {
    await this.projectService.confirmPlan(req.user.id, req.user.orgId ?? null, projectId);
    return { success: true, message: '方案已确认，可前往规格页或交付页继续' };
  }
}
