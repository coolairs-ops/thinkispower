import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { DemoSnapshotService } from './demo-snapshot.service';
import { DemoSnapshotController } from './demo-snapshot.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DemoSnapshotController],
  providers: [DemoSnapshotService],
  exports: [DemoSnapshotService],
})
export class DemoSnapshotModule {}
