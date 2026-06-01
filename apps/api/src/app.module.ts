import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module';
import { EventModule } from './events/event.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectModule } from './modules/project/project.module';
import { MessageModule } from './modules/message/message.module';
import { PlanModule } from './modules/plan/plan.module';
import { DemoModule } from './modules/demo/demo.module';
import { DemoSnapshotModule } from './modules/demo-snapshot/demo-snapshot.module';
import { DeploymentModule } from './modules/deployment/deployment.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { TaskModule } from './modules/task/task.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HermesModule } from './integrations/hermes/hermes.module';
import { CloudecodeModule } from './integrations/cloudecode/cloudecode.module';
import { PipelineModule } from './integrations/pipeline/pipeline.module';
import { MinioModule } from './integrations/minio/minio.module';
import { CaseReviewModule } from './modules/case-review/case-review.module';
import { ExperienceRecommendationModule } from './modules/experience-recommendation/experience-recommendation.module';
import { SensorModule } from './modules/sensor/sensor.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { PlanGuard } from './common/guards/plan.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HealthController } from './modules/health/health.controller';
import { SanitizeService } from './services/sanitize.service';
import { StatusMapperService } from './services/status-mapper.service';
import { SanitizeInterceptor } from './common/interceptors/sanitize.interceptor';
import { DeepseekService } from './services/deepseek.service';
import { ClarifyService } from './services/clarify.service';
import { PlanGeneratorService } from './services/plan-generator.service';
import { DemoGeneratorService } from './services/demo-generator.service';
import { HtmlModuleExtractorService } from './services/html-module-extractor.service';
import { HtmlValidatorService } from './services/html-validator.service';
import { ErrorMatcherService } from './services/error-matcher.service';
import { BuildService } from './services/build.service';
import { DeliveryOrchestrator } from './services/delivery-orchestrator.service';
import { ProductDiscoveryService } from './services/product-discovery.service';
import { HermesQualityService } from './services/hermes-quality.service';
import { QualityGateService } from './services/quality-gate.service';
import { IterativeOptimizerService } from './services/iterative-optimizer.service';
import { DesignAdvisorService } from './services/design-advisor.service';
// 客观传感器系统 — L1静态/L2运行时/L3语义
import { QwenClient } from './sensors/qwen-client.service';
import { CompileValidator } from './sensors/compile-validator.service';
import { CrossValidator } from './sensors/cross-validator.service';
import { TraceabilityValidator } from './sensors/traceability-validator.service';
import { ScreenshotComparator } from './sensors/screenshot-comparator.service';
import { SensorFusionService } from './sensors/sensor-fusion.service';
import { L1StaticSensor } from './sensors/l1-static.sensor';
import { L2RuntimeSensor } from './sensors/l2-runtime.sensor';
import { L3SemanticSensor } from './sensors/l3-semantic.sensor';
import { SensorService } from './sensors/sensor.service';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { SpecificationModule } from './modules/specification/specification.module';
import { DecisionEngineService } from './services/decision-engine.service';
import { DecisionController } from './modules/specification/decision.controller';
import { WarningService } from './services/warning.service';
import { WarningController } from './modules/specification/warning.controller';
import { TestDeploymentService } from './services/test-deployment.service';
import { TestDeploymentController } from './modules/specification/test-deployment.controller';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EventModule,
    AuthModule,
    ProjectModule,
    MessageModule,
    PlanModule,
    DemoModule,
    FeedbackModule,
    TaskModule,
    DemoSnapshotModule,
    DeploymentModule,
    DeliveryModule,
    HermesModule,
    CloudecodeModule,
    PipelineModule,
    MinioModule,
    CaseReviewModule,
    ExperienceRecommendationModule,
    SensorModule,
    WebhookModule,
    DiscoveryModule,
    SpecificationModule,
  ],
  controllers: [HealthController, DecisionController, WarningController, TestDeploymentController],
  providers: [
    SanitizeService, StatusMapperService, DeepseekService, ClarifyService,
    PlanGeneratorService, DemoGeneratorService, HtmlModuleExtractorService,
    HtmlValidatorService, ErrorMatcherService, BuildService,
    DeliveryOrchestrator, ProductDiscoveryService, HermesQualityService,
    QualityGateService, IterativeOptimizerService, DesignAdvisorService, DecisionEngineService, WarningService, TestDeploymentService,
    // 客观传感器
    QwenClient, CompileValidator, CrossValidator, TraceabilityValidator,
    ScreenshotComparator, SensorFusionService, L1StaticSensor, L2RuntimeSensor, L3SemanticSensor, SensorService,
    { provide: APP_INTERCEPTOR, useClass: SanitizeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    PlanGuard,
  ],
  exports: [SanitizeService, StatusMapperService, DeepseekService, ClarifyService, PlanGeneratorService, DemoGeneratorService, HtmlModuleExtractorService, HtmlValidatorService, ErrorMatcherService, BuildService, ProductDiscoveryService, HermesQualityService, DesignAdvisorService, IterativeOptimizerService, DecisionEngineService, WarningService, TestDeploymentService,
    QwenClient, CompileValidator, CrossValidator, TraceabilityValidator, ScreenshotComparator, SensorFusionService,
    L1StaticSensor, L2RuntimeSensor, L3SemanticSensor, SensorService],
})
export class AppModule {}
