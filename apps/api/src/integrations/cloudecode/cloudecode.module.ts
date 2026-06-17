import { Module } from '@nestjs/common';
import { CloudecodeClient } from './cloudecode.client';
import { DemoSnapshotModule } from '../../modules/demo-snapshot/demo-snapshot.module';
import { SharedCoreModule } from '../../shared/shared-core.module';
import { AppRuntimeModule } from '../../modules/app-runtime/app-runtime.module';

@Module({
  imports: [SharedCoreModule, DemoSnapshotModule, AppRuntimeModule],
  providers: [CloudecodeClient],
  exports: [CloudecodeClient],
})
export class CloudecodeModule {}
