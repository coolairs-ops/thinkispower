import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectModule } from './modules/project/project.module';
import { MessageModule } from './modules/message/message.module';
import { PlanModule } from './modules/plan/plan.module';
import { DemoModule } from './modules/demo/demo.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { TaskModule } from './modules/task/task.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HealthController } from './modules/health/health.controller';
import { SanitizeService } from './services/sanitize.service';
import { StatusMapperService } from './services/status-mapper.service';
import { DeepseekService } from './services/deepseek.service';
import { ClarifyService } from './services/clarify.service';
import { PlanGeneratorService } from './services/plan-generator.service';
import { DemoGeneratorService } from './services/demo-generator.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ProjectModule,
    MessageModule,
    PlanModule,
    DemoModule,
    FeedbackModule,
    TaskModule,
    DeliveryModule,
  ],
  controllers: [HealthController],
  providers: [SanitizeService, StatusMapperService, DeepseekService, ClarifyService, PlanGeneratorService, DemoGeneratorService],
  exports: [SanitizeService, StatusMapperService, DeepseekService, ClarifyService, PlanGeneratorService, DemoGeneratorService],
})
export class AppModule {}
