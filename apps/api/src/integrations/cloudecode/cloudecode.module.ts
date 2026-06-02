import { Module } from '@nestjs/common';
import { CloudecodeClient } from './cloudecode.client';
import { DemoSnapshotModule } from '../../modules/demo-snapshot/demo-snapshot.module';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule, DemoSnapshotModule],
  providers: [CloudecodeClient],
  exports: [CloudecodeClient],
})
export class CloudecodeModule {}
