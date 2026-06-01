import { Module } from '@nestjs/common';
import { PipelineModule } from '../../integrations/pipeline/pipeline.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [PipelineModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
