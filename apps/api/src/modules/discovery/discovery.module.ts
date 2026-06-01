import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryEngineService } from '../../services/discovery-engine.service';
import { CompletenessCheckerService } from '../../services/completeness-checker.service';

@Module({
  imports: [],
  controllers: [DiscoveryController],
  providers: [DiscoveryEngineService, CompletenessCheckerService],
})
export class DiscoveryModule {}
