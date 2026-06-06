import { Module } from '@nestjs/common';
import { SecurityGateService } from './security-gate.service';
import { ExecutorRouterService } from './executor-router.service';

/**
 * 交付控制层（Delivery Control）
 *
 * 让自动开发过程「受控」：任务边界、执行器路由、验证、安全闸门、经验沉淀。
 * 当前为骨架阶段 —— 提供 SecurityGate、ExecutorRouter，尚未接入主交付流程。
 * 后续按 docs/architecture/EVOLUTION_PLAN.md 逐步填充并灰度接入。
 */
@Module({
  providers: [SecurityGateService, ExecutorRouterService],
  exports: [SecurityGateService, ExecutorRouterService],
})
export class DeliveryControlModule {}
