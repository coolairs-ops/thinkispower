import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { CaseReviewService } from './case-review.service';
import { CaseReviewController } from './case-review.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CaseReviewController],
  providers: [CaseReviewService],
  exports: [CaseReviewService],
})
export class CaseReviewModule {}
