import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoProcessor } from './demo.processor';
import { ThemeService } from './theme.service';
import { DEMO_QUEUE } from './demo.queue';
import { DemoSnapshotModule } from '../demo-snapshot/demo-snapshot.module';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';
import { LlmModule } from '../../integrations/llm/llm.module';
import { ScreenshotReplicateService } from './screenshot-replicate.service';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule, DemoSnapshotModule, CloudecodeModule, LlmModule, BullModule.registerQueue({ name: DEMO_QUEUE })],
  controllers: [DemoController],
  providers: [DemoService, DemoProcessor, ThemeService, ScreenshotReplicateService],
  exports: [DemoService, ThemeService, ScreenshotReplicateService],
})
export class DemoModule {}
