import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { HermesModule } from '../../integrations/hermes/hermes.module';
import { N8nModule } from '../../integrations/n8n/n8n.module';
import { CaseReviewModule } from '../case-review/case-review.module';
import { ExperienceRecommendationModule } from '../experience-recommendation/experience-recommendation.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { QualityGateService } from '../../services/quality-gate.service';
import { DemoModule } from '../demo/demo.module';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';

@Module({
  imports: [HermesModule, N8nModule, CaseReviewModule, ExperienceRecommendationModule, DeploymentModule, DemoModule, CloudecodeModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, QualityGateService],
  exports: [DeliveryService],
})
export class DeliveryModule {}

