import { Global, Module } from '@nestjs/common';
import { N8nClient } from './n8n.client';

@Global()
@Module({
  providers: [N8nClient],
  exports: [N8nClient],
})
export class N8nModule {}
