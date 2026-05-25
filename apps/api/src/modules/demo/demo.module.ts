import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoSnapshotModule } from '../demo-snapshot/demo-snapshot.module';

@Module({
  imports: [DemoSnapshotModule],
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
