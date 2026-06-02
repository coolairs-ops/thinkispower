import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { DemoViewController } from './demo-view.controller';
import { DeliveryModule } from '../delivery/delivery.module';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule, DeliveryModule],
  controllers: [ProjectController, DemoViewController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
