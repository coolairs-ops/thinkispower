import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoSnapshotModule } from '../demo-snapshot/demo-snapshot.module';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';

@Module({
  imports: [DemoSnapshotModule, CloudecodeModule],
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
