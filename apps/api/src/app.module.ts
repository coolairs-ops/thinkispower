import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module';
import { EventModule } from './events/event.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectModule } from './modules/project/project.module';
import { MessageModule } from './modules/message/message.module';
import { PlanModule } from './modules/plan/plan.module';
import { DemoModule } from './modules/demo/demo.module';
import { DemoSnapshotModule } from './modules/demo-snapshot/demo-snapshot.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { TaskModule } from './modules/task/task.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { OpenClawModule } from './integrations/openclaw/openclaw.module';
import { CloudecodeModule } from './integrations/cloudecode/cloudecode.module';
import { PipelineModule } from './integrations/pipeline/pipeline.module';
import { HealthController } from './modules/health/health.controller';
import { SanitizeService } from './services/sanitize.service';
import { StatusMapperService } from './services/status-mapper.service';
import { DeepseekService } from './services/deepseek.service';
import { ClarifyService } from './services/clarify.service';
import { PlanGeneratorService } from './services/plan-generator.service';
import { DemoGeneratorService } from './services/demo-generator.service';
import { HtmlModuleExtractorService } from './services/html-module-extractor.service';
import { HtmlValidatorService } from './services/html-validator.service';
import { ErrorMatcherService } from './services/error-matcher.service';
import { BuildService } from './services/build.service';
import { DeliveryOrchestrator } from './services/delivery-orchestrator.service';

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
    DeliveryModule,
    OpenClawModule,
    CloudecodeModule,
    PipelineModule,
  ],
  controllers: [HealthController],
  providers: [SanitizeService, StatusMapperService, DeepseekService, ClarifyService, PlanGeneratorService, DemoGeneratorService, HtmlModuleExtractorService, HtmlValidatorService, ErrorMatcherService, BuildService, DeliveryOrchestrator],
  exports: [SanitizeService, StatusMapperService, DeepseekService, ClarifyService, PlanGeneratorService, DemoGeneratorService, HtmlModuleExtractorService, HtmlValidatorService, ErrorMatcherService, BuildService],
})
export class AppModule {}
