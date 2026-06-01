import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryEvaluationService } from './delivery-evaluation.service';
import { DeliveryIterationService } from './delivery-iteration.service';
import { HermesModule } from '../../integrations/hermes/hermes.module';
import { CaseReviewModule } from '../case-review/case-review.module';
import { ExperienceRecommendationModule } from '../experience-recommendation/experience-recommendation.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { QualityGateService } from '../../services/quality-gate.service';
import { DemoModule } from '../demo/demo.module';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';

@Module({
  imports: [HermesModule, CaseReviewModule, ExperienceRecommendationModule, DeploymentModule, DemoModule, CloudecodeModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryEvaluationService, DeliveryIterationService, QualityGateService],
  exports: [DeliveryService, DeliveryEvaluationService, DeliveryIterationService],
})
export class DeliveryModule {}
