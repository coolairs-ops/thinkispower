import { Module } from '@nestjs/common';
import { HermesClient } from './hermes.client';
import { HermesListener } from './hermes.listener';
import { N8nModule } from '../n8n/n8n.module';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule, N8nModule],
  providers: [HermesClient, HermesListener],
  exports: [HermesClient],
})
export class HermesModule {}
