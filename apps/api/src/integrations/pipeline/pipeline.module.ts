import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { TaskModule } from '../../modules/task/task.module';
import { CloudecodeModule } from '../cloudecode/cloudecode.module';
import { DemoSnapshotModule } from '../../modules/demo-snapshot/demo-snapshot.module';
import { DeploymentModule } from '../../modules/deployment/deployment.module';
import { SharedCoreModule } from '../../shared/shared-core.module';
import { DeliveryControlModule } from '../../delivery-control/delivery-control.module';

@Module({
  imports: [SharedCoreModule, TaskModule, CloudecodeModule, DemoSnapshotModule, DeploymentModule, DeliveryControlModule],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
