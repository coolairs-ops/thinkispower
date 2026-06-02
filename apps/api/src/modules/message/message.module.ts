import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { HermesModule } from '../../integrations/hermes/hermes.module';
import { ProductDiscoveryModule } from '../product-discovery/product-discovery.module';
import { HermesQualityModule } from '../hermes-quality/hermes-quality.module';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule, HermesModule, ProductDiscoveryModule, HermesQualityModule],
  controllers: [MessageController],
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageModule {}
