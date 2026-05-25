import { Module } from '@nestjs/common';
import { CloudecodeClient } from './cloudecode.client';
import { DemoSnapshotModule } from '../../modules/demo-snapshot/demo-snapshot.module';

@Module({
  imports: [DemoSnapshotModule],
  providers: [CloudecodeClient],
  exports: [CloudecodeClient],
})
export class CloudecodeModule {}
