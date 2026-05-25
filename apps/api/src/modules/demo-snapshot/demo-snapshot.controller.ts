import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DemoSnapshotService } from './demo-snapshot.service';

@UseGuards(JwtAuthGuard)
@Controller('api/projects/:projectId/demo')
export class DemoSnapshotController {
  constructor(private readonly snapshotService: DemoSnapshotService) {}

  @Get('snapshots')
  async listSnapshots(@Param('projectId') projectId: string) {
    return this.snapshotService.findByProject(projectId);
  }

  @Get('snapshots/:id')
  async getSnapshot(@Param('id') id: string) {
    return this.snapshotService.findById(id);
  }

  @Post('rollback')
  async rollback(
    @Param('projectId') projectId: string,
    @Body('snapshotId') snapshotId: string,
  ) {
    await this.snapshotService.rollback(projectId, snapshotId);
    return { message: '回滚成功' };
  }
}
