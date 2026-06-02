import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryEvaluationService } from './delivery-evaluation.service';
import { DeliveryIterationService } from './delivery-iteration.service';
import { QwenReviewerService } from '../../services/qwen-reviewer.service';
import { HermesModule } from '../../integrations/hermes/hermes.module';
import { CaseReviewModule } from '../case-review/case-review.module';
import { ExperienceRecommendationModule } from '../experience-recommendation/experience-recommendation.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { DemoModule } from '../demo/demo.module';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';
import { SensorModule } from '../sensor/sensor.module';
import { SharedCoreModule } from '../../shared/shared-core.module';
import { IterativeOptimizerService } from '../../services/iterative-optimizer.service';

@Module({
  imports: [SharedCoreModule, HermesModule, CaseReviewModule, ExperienceRecommendationModule, DeploymentModule, DemoModule, CloudecodeModule, SensorModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryEvaluationService, DeliveryIterationService, QwenReviewerService, IterativeOptimizerService],
  exports: [DeliveryService, DeliveryEvaluationService, DeliveryIterationService],
})
export class DeliveryModule {}
