import { Module } from '@nestjs/common';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';
import { TaskModule } from '../task/task.module';
import { DemoModule } from '../demo/demo.module';
import { N8nWebhookController } from './n8n-webhook.controller';
import { WorkflowInternalController } from './workflow-internal.controller';

@Module({
  imports: [CloudecodeModule, TaskModule, DemoModule],
  controllers: [N8nWebhookController, WorkflowInternalController],
})
export class N8nWebhookModule {}
