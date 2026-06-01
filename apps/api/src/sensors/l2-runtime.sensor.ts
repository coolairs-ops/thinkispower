import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { SensorReport, SensorCheck } from './sensor-report.interface';

@Injectable()
export class L2RuntimeSensor {
  private readonly logger = new Logger(L2RuntimeSensor.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async run(projectId?: string): Promise<SensorReport> {
    const checks: SensorCheck[] = [];

    // 1. 数据库连接健康度
    checks.push(await this.checkDatabaseHealth());

    // 2. 事件系统健康度 — 检查事件监听器数量
    checks.push(this.checkEventBusHealth());

    // 3. 第三方服务可用性
    const [minioCheck, n8nCheck] = await Promise.all([
      this.checkMinioHealth(),
      this.checkN8nHealth(),
    ]);
    checks.push(minioCheck);
    checks.push(n8nCheck);

    // 4. 如果指定了项目，检查任务执行健康度
    if (projectId) {
      checks.push(await this.checkTaskHealth(projectId));
    }

    const score = this.computeScore(checks);
    return {
      sensorName: 'L2-运行时状态',
      layer: 2,
      passed: checks.every(c => c.passed || c.weight < 20),
      score,
      checks,
    };
  }

  private async checkDatabaseHealth(): Promise<SensorCheck> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      const passed = latency < 1000;
      return {
        name: '数据库连接',
        passed,
        score: passed ? (latency < 100 ? 100 : Math.max(60, 100 - latency / 10)) : 0,
        weight: 30,
        detail: `${latency}ms${passed ? '' : ' (响应时间过长)'}`,
      };
    } catch (err) {
      return {
        name: '数据库连接',
        passed: false,
        score: 0,
        weight: 30,
        error: `数据库连接失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private checkEventBusHealth(): SensorCheck {
    const listenerCount = this.eventEmitter.listeners('*' as any)?.length ?? 0;
    const passed = listenerCount < 50;
    return {
      name: '事件总线',
      passed,
      score: passed ? 100 : Math.max(0, 100 - (listenerCount - 50) * 2),
      weight: 15,
      detail: `${listenerCount} 个监听器${passed ? '' : ' (建议优化，避免内存泄漏)'}`,
    };
  }

  private async checkMinioHealth(): Promise<SensorCheck> {
    try {
      const endpoint = this.config.get<string>('MINIO_ENDPOINT', 'minio:9000');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`http://${endpoint}/minio/health/live`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const passed = res.ok;
      return {
        name: 'MinIO 存储',
        passed,
        score: passed ? 100 : 0,
        weight: 20,
        detail: passed ? '可用' : `状态码 ${res.status}`,
      };
    } catch (err) {
      this.logger.warn(`MinIO健康检查失败(不阻断): ${err}`);
      return {
        name: 'MinIO 存储',
        passed: false,
        score: 0,
        weight: 20,
        error: 'MinIO 不可用',
      };
    }
  }

  private async checkN8nHealth(): Promise<SensorCheck> {
    try {
      const n8nUrl = this.config.get<string>('N8N_URL', 'http://n8n:5678');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${n8nUrl}/healthz`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const passed = res.ok;
      return {
        name: 'N8N 工作流引擎',
        passed,
        score: passed ? 100 : 0,
        weight: 15,
        detail: passed ? '可用' : `状态码 ${res.status} (平台将降级到本地 Pipeline)`,
      };
    } catch {
      return {
        name: 'N8N 工作流引擎',
        passed: false,
        score: 0,
        weight: 15,
        detail: '不可用 (平台将降级到本地 Pipeline)',
      };
    }
  }

  private async checkTaskHealth(projectId: string): Promise<SensorCheck> {
    try {
      const stats = await this.prisma.task.aggregate({
        where: { projectId },
        _count: true,
      });

      const failedCount = await this.prisma.task.count({
        where: { projectId, status: 'failed' },
      });

      const totalCount = stats._count;
      const failedRatio = totalCount > 0 ? failedCount / totalCount : 0;
      const passed = failedRatio < 0.3;

      return {
        name: '任务执行健康度',
        passed,
        score: passed ? 100 : Math.max(0, 100 - Math.round(failedRatio * 100)),
        weight: 20,
        detail: `${totalCount}个任务, ${failedCount}个失败`,
      };
    } catch (err) {
      return {
        name: '任务执行健康度',
        passed: true,
        score: 100,
        weight: 20,
        error: `查询失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private computeScore(checks: SensorCheck[]): number {
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    if (totalWeight === 0) return 0;
    return Math.round(checks.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);
  }
}
