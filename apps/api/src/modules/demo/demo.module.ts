import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoProcessor } from './demo.processor';
import { DEMO_QUEUE } from './demo.queue';
import { DemoSnapshotModule } from '../demo-snapshot/demo-snapshot.module';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule, DemoSnapshotModule, CloudecodeModule, BullModule.registerQueue({ name: DEMO_QUEUE })],
  controllers: [DemoController],
  providers: [DemoService, DemoProcessor],
  exports: [DemoService],
})
export class DemoModule {}
