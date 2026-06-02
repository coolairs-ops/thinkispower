import { Module } from '@nestjs/common';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { DemoModule } from '../demo/demo.module';
import { PlanGeneratorModule } from '../plan-generator/plan-generator.module';
import { DesignAdvisorModule } from '../design-advisor/design-advisor.module';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule, DemoModule, PlanGeneratorModule, DesignAdvisorModule],
  controllers: [PlanController],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
