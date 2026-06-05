import { Module } from '@nestjs/common';
import { HermesClient } from './hermes.client';
import { HermesListener } from './hermes.listener';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule],
  providers: [HermesClient, HermesListener],
  exports: [HermesClient],
})
export class HermesModule {}
