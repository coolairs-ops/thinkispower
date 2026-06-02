import { Module } from '@nestjs/common';
import { DesignAdvisorService } from '../../services/design-advisor.service';

@Module({
  providers: [DesignAdvisorService],
  exports: [DesignAdvisorService],
})
export class DesignAdvisorModule {}
