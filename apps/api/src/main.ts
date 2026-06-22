import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { UserFriendlyExceptionFilter } from './common/filters/user-friendly-exception.filter';

// BigInt 序列化兜底：Prisma 的 BigInt 字段（如 AssetFile.sizeBytes）默认无法被 res.json 序列化
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

// 全局未捕获异常/Promise 日志钩子：Node 默认会因 unhandledRejection 直接退进程——曾致 API 静默挂掉，
// 进而前端 SSR 请求 :3002 收到 ECONNREFUSED → "Server Error / Jest worker exceptions"。
// 这里捕获并打全栈、**不退出（保活）**，让真凶进日志、避免静默中断。
const processLogger = new Logger('Process');
process.on('unhandledRejection', (reason) => {
  processLogger.error(`未捕获的 Promise rejection（已记录、进程保活）: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
process.on('uncaughtException', (err) => {
  processLogger.error(`未捕获异常（已记录、进程保活）: ${err instanceof Error ? err.stack : String(err)}`);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger API 文档
  const config = new DocumentBuilder()
    .setTitle('Think-is-power API')
    .setDescription('PM自助交付平台 — AI驱动全栈应用生成系统')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  app.use(express.urlencoded({ extended: true }));

  app.enableCors({
    origin: (origin, callback) => {
      const allowed = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'http://localhost:3003',
        'http://localhost:4200',
        process.env.CORS_ORIGIN,
      ].filter(Boolean);
      // WSL/NAT 环境：允许所有私有 IP 的请求（172.x, 192.168.x, 10.x）
      const isPrivateIP = origin && /^https?:\/\/(172\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/.test(origin);
      if (!origin || allowed.includes(origin) || isPrivateIP) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new UserFriendlyExceptionFilter());

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Platform API running on http://localhost:${port}`);
}

bootstrap();
