import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryEngineService } from './discovery-engine.service';
import { CompletenessCheckerService } from './completeness-checker.service';

import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryEngineService, CompletenessCheckerService],
})
export class DiscoveryModule {}
