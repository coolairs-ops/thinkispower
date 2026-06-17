import { Module } from '@nestjs/common';
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
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { SpecificationModule } from './modules/specification/specification.module';
import { PlanGuard } from './common/guards/plan.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HealthController } from './modules/health/health.controller';
import { SanitizeInterceptor } from './common/interceptors/sanitize.interceptor';
import { DeliveryOrchestrator } from './services/delivery-orchestrator.service';
import { SharedCoreModule } from './shared/shared-core.module';
import { QueueModule } from './queue/queue.module';
import { ProfessionalImportModule } from './modules/professional-import/professional-import.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { GuardianModule } from './modules/guardian/guardian.module';

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
    SharedCoreModule,
    QueueModule,
    ProfessionalImportModule,
    ComplianceModule,
    GuardianModule,
  ],
  controllers: [HealthController],
  providers: [
    DeliveryOrchestrator,
    { provide: APP_INTERCEPTOR, useClass: SanitizeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    PlanGuard,
  ],
})
export class AppModule {}
