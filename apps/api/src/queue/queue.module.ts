import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

export const DELIVERY_QUEUE = 'delivery';

/**
 * 任务队列地基（BullMQ + Redis）—— 架构演进 S0.1。
 *
 * 为后续 TaskRunner 提供持久化、可跨实例的异步任务队列，取代当前
 * fire-and-forget 内存异步（demo 生成卡死即源于「进程重启任务丢失」）。
 * 连接配置从环境变量读取（容器内 REDIS_HOST=redis）。
 * 当前仅注册队列、不接业务（脚手架阶段）。
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: Number(config.get('REDIS_PORT', 6379)),
        },
      }),
    }),
    BullModule.registerQueue({ name: DELIVERY_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
