import { Module } from '@nestjs/common';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';
import { TaskModule } from '../task/task.module';
import { N8nWebhookController } from './n8n-webhook.controller';

@Module({
  imports: [CloudecodeModule, TaskModule],
  controllers: [N8nWebhookController],
})
export class N8nWebhookModule {}
