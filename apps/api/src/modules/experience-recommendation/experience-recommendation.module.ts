import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { ExperienceRecommendationService } from './experience-recommendation.service';
import { ExperienceRecommendationController } from './experience-recommendation.controller';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule, PrismaModule],
  controllers: [ExperienceRecommendationController],
  providers: [ExperienceRecommendationService],
  exports: [ExperienceRecommendationService],
})
export class ExperienceRecommendationModule {}
