import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GuardianController } from './guardian.controller';
import { GuardianService } from './guardian.service';
import { GuardianRemediationService } from './guardian-remediation.service';
import { GuardianReportService } from './guardian-report.service';
import { GuardianProcessor } from './guardian.processor';
import { GUARDIAN_QUEUE } from './guardian.queue';
import { DeliveryModule } from '../delivery/delivery.module';

/**
 * 守护中心模块（Phase 2 最小闭环）。
 * 复用 DeliveryModule 导出的验收引擎；单向依赖，无循环（Delivery 不反向依赖 Guardian）。
 */
@Module({
  imports: [DeliveryModule, BullModule.registerQueue({ name: GUARDIAN_QUEUE })],
  controllers: [GuardianController],
  providers: [GuardianService, GuardianRemediationService, GuardianReportService, GuardianProcessor],
  exports: [GuardianService, GuardianRemediationService],
})
export class GuardianModule {}
