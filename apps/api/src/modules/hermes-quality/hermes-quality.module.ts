import { Module } from '@nestjs/common';
import { HermesQualityService } from '../../services/hermes-quality.service';

@Module({
  providers: [HermesQualityService],
  exports: [HermesQualityService],
})
export class HermesQualityModule {}
