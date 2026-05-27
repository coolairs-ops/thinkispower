import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { TaskModule } from '../../modules/task/task.module';
import { CloudecodeModule } from '../cloudecode/cloudecode.module';
import { DemoSnapshotModule } from '../../modules/demo-snapshot/demo-snapshot.module';
import { BuildService } from '../../services/build.service';

@Module({
  imports: [TaskModule, CloudecodeModule, DemoSnapshotModule],
  providers: [PipelineService, BuildService],
  exports: [PipelineService],
})
export class PipelineModule {}
