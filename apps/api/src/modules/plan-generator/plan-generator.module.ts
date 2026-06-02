import { Module } from '@nestjs/common';
import { PlanGeneratorService } from '../../services/plan-generator.service';

@Module({
  providers: [PlanGeneratorService],
  exports: [PlanGeneratorService],
})
export class PlanGeneratorModule {}
