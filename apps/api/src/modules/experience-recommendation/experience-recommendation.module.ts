import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { ExperienceRecommendationService } from './experience-recommendation.service';
import { ExperienceRecommendationController } from './experience-recommendation.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ExperienceRecommendationController],
  providers: [ExperienceRecommendationService],
  exports: [ExperienceRecommendationService],
})
export class ExperienceRecommendationModule {}
