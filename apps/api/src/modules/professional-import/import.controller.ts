import {
  Controller, Get, Post, Body, Param, UseGuards, Req, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ImportBatchService } from './import-batch.service';
import { AssetFileService, UploadedAsset } from './asset-file.service';
import { ImportUnderstandingService } from './import-understanding.service';
import { SpecMaterializeService } from './spec-materialize.service';
import { TenantContext } from '../../common/utils/tenant-scope';

@Controller('api/import/batches')
@UseGuards(JwtAuthGuard)
export class ImportController {
  constructor(
    private batchService: ImportBatchService,
    private assetService: AssetFileService,
    private understandingService: ImportUnderstandingService,
    private materializeService: SpecMaterializeService,
  ) {}

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

  /** 接收一份上传文件：落域内对象存储 + 登记 AssetFile（multipart 字段名 file） */
  @Post(':batchId/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  addFile(
    @Req() req: { user: { id: string; orgId?: string | null } },
    @Param('batchId') batchId: string,
    @UploadedFile() file: UploadedAsset | undefined,
    @Body() body: { category?: string },
  ) {
    return this.assetService.addFile(this.ctx(req), batchId, file, body?.category);
  }

  /** 汇总批次内各份理解笔记 → 生成需求理解(处理文档)，批次推进到 ready_for_review */
  @Post(':batchId/understand')
  understand(
    @Req() req: { user: { id: string; orgId?: string | null } },
    @Param('batchId') batchId: string,
  ) {
    return this.understandingService.summarize(this.ctx(req), batchId);
  }

  /** PM 确认 → 把需求理解物化为带溯源的草稿规格(承载项目)，汇入现有规格链路 */
  @Post(':batchId/materialize-spec')
  materializeSpec(
    @Req() req: { user: { id: string; orgId?: string | null } },
    @Param('batchId') batchId: string,
  ) {
    return this.materializeService.materializeSpec(this.ctx(req), batchId);
  }
}
