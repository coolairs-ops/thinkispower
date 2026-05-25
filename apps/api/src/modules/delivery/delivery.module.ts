import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { OpenClawModule } from '../../integrations/openclaw/openclaw.module';
import { N8nModule } from '../../integrations/n8n/n8n.module';

@Module({
  imports: [OpenClawModule, N8nModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}

