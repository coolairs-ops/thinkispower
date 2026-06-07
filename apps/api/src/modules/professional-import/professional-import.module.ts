import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImportController } from './import.controller';
import { ImportBatchService } from './import-batch.service';
import { AssetFileService } from './asset-file.service';
import { ImportParseService } from './import-parse.service';
import { ImportParseProcessor, IMPORT_PARSE_QUEUE } from './import-parse.processor';
import { ImportUnderstandingService } from './import-understanding.service';
import { SpecMaterializeService } from './spec-materialize.service';
import { ConflictDetectionService } from './conflict-detection.service';
import { LlmModule } from '../../integrations/llm/llm.module';

/**
 * 专业资料导入（Phase 1.5）。
 * 第 1 步：导入批次生命周期。第 2 步：文件接收(AssetFile+MinIO+checksum)。
 * 第 3 步：逐份理解(LlmGateway + BullMQ 异步) → AssetFile.parseSummary。
 * 第 4 步：汇总成 RequirementUnderstanding(处理文档，纯代码合并 + 溯源)。
 * 第 5 步：物化为带溯源的草稿 Specification(P15-8)，汇入现有规格链路。
 * MinioService 由 @Global MinioModule 提供；BullMQ 根连接由 QueueModule(forRoot) 提供；
 * StatusMapperService 由 @Global SharedCoreModule 提供。
 */
@Module({
  imports: [LlmModule, BullModule.registerQueue({ name: IMPORT_PARSE_QUEUE })],
  controllers: [ImportController],
  providers: [
    ImportBatchService,
    AssetFileService,
    ImportParseService,
    ImportParseProcessor,
    ImportUnderstandingService,
    SpecMaterializeService,
    ConflictDetectionService,
  ],
  exports: [
    ImportBatchService,
    AssetFileService,
    ImportParseService,
    ImportUnderstandingService,
    SpecMaterializeService,
  ],
})
export class ProfessionalImportModule {}
