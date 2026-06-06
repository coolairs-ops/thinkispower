import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ImportBatchService } from './import-batch.service';
import { TenantContext } from '../../common/utils/tenant-scope';

@Controller('api/import/batches')
@UseGuards(JwtAuthGuard)
export class ImportController {
  constructor(private batchService: ImportBatchService) {}

  private ctx(req: { user: { id: string; orgId?: string | null } }): TenantContext {
    return { userId: req.user.id, orgId: req.user.orgId ?? null };
  }

  @Post()
  create(@Req() req: { user: { id: string; orgId?: string | null } }, @Body() body: { name?: string; projectId?: string }) {
    return this.batchService.create(this.ctx(req), body);
  }

  @Get()
  list(@Req() req: { user: { id: string; orgId?: string | null } }) {
    return this.batchService.list(this.ctx(req));
  }

  @Get(':batchId')
  get(@Req() req: { user: { id: string; orgId?: string | null } }, @Param('batchId') batchId: string) {
    return this.batchService.get(this.ctx(req), batchId);
  }
}
