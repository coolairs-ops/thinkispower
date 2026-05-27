import { Module } from '@nestjs/common';
import { HermesClient } from './hermes.client';
import { HermesListener } from './hermes.listener';
import { N8nModule } from '../n8n/n8n.module';

@Module({
  imports: [N8nModule],
  providers: [HermesClient, HermesListener],
  exports: [HermesClient],
})
export class HermesModule {}
