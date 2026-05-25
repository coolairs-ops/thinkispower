import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { TaskModule } from '../../modules/task/task.module';
import { CloudecodeModule } from '../cloudecode/cloudecode.module';
import { DemoSnapshotModule } from '../../modules/demo-snapshot/demo-snapshot.module';

@Module({
  imports: [TaskModule, CloudecodeModule, DemoSnapshotModule],
  providers: [PipelineService],
})
export class PipelineModule {}
