import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImportParseService } from './import-parse.service';

export const IMPORT_PARSE_QUEUE = 'import-parse';

export interface ImportParseJob {
  assetId: string;
}

/**
 * 逐份理解的 BullMQ Worker。上传文件后入队，异步逐份调 LLM 理解，结果落 AssetFile.parseSummary。
 * 持久化 + 可跨实例 + 失败重试，避免「进程重启任务丢失」。
 */
@Processor(IMPORT_PARSE_QUEUE)
export class ImportParseProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportParseProcessor.name);

  constructor(private parseService: ImportParseService) {
    super();
  }

  async process(job: Job<ImportParseJob>): Promise<void> {
    const { assetId } = job.data;
    this.logger.log(`逐份理解开始 asset=${assetId} (job ${job.id})`);
    await this.parseService.parseAsset(assetId);
  }
}
