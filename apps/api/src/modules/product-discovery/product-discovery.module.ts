import { Module } from '@nestjs/common';
import { ProductDiscoveryService } from '../../services/product-discovery.service';
import { SharedCoreModule } from '../../shared/shared-core.module';

@Module({
  imports: [SharedCoreModule],
  providers: [ProductDiscoveryService],
  exports: [ProductDiscoveryService],
})
export class ProductDiscoveryModule {}
