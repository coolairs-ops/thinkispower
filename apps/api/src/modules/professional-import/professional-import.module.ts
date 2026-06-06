import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportBatchService } from './import-batch.service';

/**
 * 专业资料导入（Phase 1.5）。
 * 第 1 步：导入批次生命周期。后续：文件接收(AssetFile+MinIO) → 逐份理解(LlmGateway+BullMQ) → 处理文档。
 */
@Module({
  controllers: [ImportController],
  providers: [ImportBatchService],
  exports: [ImportBatchService],
})
export class ProfessionalImportModule {}
