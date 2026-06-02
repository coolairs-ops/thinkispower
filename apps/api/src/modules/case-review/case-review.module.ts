import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { CaseReviewService } from './case-review.service';
import { CaseReviewController } from './case-review.controller';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule, PrismaModule],
  controllers: [CaseReviewController],
  providers: [CaseReviewService],
  exports: [CaseReviewService],
})
export class CaseReviewModule {}
