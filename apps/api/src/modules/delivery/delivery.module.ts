import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryEvaluationService } from './delivery-evaluation.service';
import { DeliveryProcessor } from './delivery.processor';
import { DELIVERY_QUEUE } from './delivery.queue';
import { AutoIterateProcessor } from './auto-iterate.processor';
import { AUTO_ITERATE_QUEUE } from './auto-iterate.queue';
import { DeliveryIterationService } from './delivery-iteration.service';
import { AcceptanceVerificationService } from './acceptance-verification.service';
import { QwenReviewerService } from '../../services/qwen-reviewer.service';
import { HermesModule } from '../../integrations/hermes/hermes.module';
import { LlmModule } from '../../integrations/llm/llm.module';
import { CaseReviewModule } from '../case-review/case-review.module';
import { ExperienceRecommendationModule } from '../experience-recommendation/experience-recommendation.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { DemoModule } from '../demo/demo.module';
import { CloudecodeModule } from '../../integrations/cloudecode/cloudecode.module';
import { SensorModule } from '../sensor/sensor.module';
import { SharedCoreModule } from '../../shared/shared-core.module';
import { IterativeOptimizerService } from '../../services/iterative-optimizer.service';
import { AppRuntimeModule } from '../app-runtime/app-runtime.module';
import { RuoyiConsoleDeployService } from './ruoyi-console-deploy.service';

@Module({
  imports: [SharedCoreModule, HermesModule, CaseReviewModule, ExperienceRecommendationModule, DeploymentModule, DemoModule, CloudecodeModule, SensorModule, LlmModule, AppRuntimeModule, BullModule.registerQueue({ name: DELIVERY_QUEUE }, { name: AUTO_ITERATE_QUEUE })],
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryEvaluationService, DeliveryProcessor, AutoIterateProcessor, DeliveryIterationService, AcceptanceVerificationService, QwenReviewerService, IterativeOptimizerService, RuoyiConsoleDeployService],
  exports: [DeliveryService, DeliveryEvaluationService, DeliveryIterationService, AcceptanceVerificationService],
})
export class DeliveryModule {}
