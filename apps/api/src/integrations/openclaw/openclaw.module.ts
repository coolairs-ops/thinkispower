import { Module } from '@nestjs/common';
import { OpenClawClient } from './openclaw.client';
import { OpenClawListener } from './openclaw.listener';

@Module({
  providers: [OpenClawClient, OpenClawListener],
  exports: [OpenClawClient],
})
export class OpenClawModule {}
