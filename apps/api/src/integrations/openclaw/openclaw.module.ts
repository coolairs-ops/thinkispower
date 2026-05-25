import { Module } from '@nestjs/common';
import { OpenClawClient } from './openclaw.client';
import { OpenClawListener } from './openclaw.listener';
import { N8nModule } from '../n8n/n8n.module';

@Module({
  imports: [N8nModule],
  providers: [OpenClawClient, OpenClawListener],
  exports: [OpenClawClient],
})
export class OpenClawModule {}
