import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

/**
 * 任务队列地基（BullMQ + Redis）—— 架构演进 S0.1。
 *
 * 仅注册全局连接（forRoot）；具体队列由各业务模块自行 registerQueue
 * （demo-generate / import-parse / delivery 等），取代 fire-and-forget 内存异步
 * （进程重启任务丢失）。连接配置从环境变量读取（容器内 REDIS_HOST=redis）。
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
  ],
  exports: [BullModule],
})
export class QueueModule {}
