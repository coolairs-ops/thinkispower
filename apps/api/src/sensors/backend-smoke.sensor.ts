import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SensorReport, SensorCheck } from './sensor-report.interface';
import {
  BACKEND_RUNTIME,
  BackendRuntime,
  BackendRuntimeDescriptor,
} from '../modules/app-runtime/backend-runtime.interface';
import { RuoyiRuntime } from '../modules/app-runtime/ruoyi-runtime.service';

/**
 * 后端连通传感器（ADR-0001 / slice 6）。
 *
 * 让自迭代闭环延伸到后端：对有数据后端的项目，经 BackendRuntime.health 逐资源探活，
 * 把不可达资源转成失败 check（→ recommendations，被自迭代看见）。
 * 无数据后端的项目跳过、不拉低分（与 L1 无 demoHtml 同策略）。
 *
 * 走 BACKEND_RUNTIME 接口而非具体实现：路 C 换后端后本传感器无需改动（约束②）。
 * check weight 取小值（10 < 25），避免触发 SensorService 的 critical 停迭代逻辑——
 * 后端不可达只拉低分并产建议，把修复机会留给迭代，而非直接中断。
 */
@Injectable()
export class BackendSmokeSensor {
  private readonly logger = new Logger(BackendSmokeSensor.name);

  constructor(
    private prisma: PrismaService,
    @Inject(BACKEND_RUNTIME) private backend: BackendRuntime,
    private ruoyi: RuoyiRuntime,
  ) {}

  async run(projectId: string): Promise<SensorReport> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { backendRuntime: true },
    });
    const d = project?.backendRuntime as unknown as BackendRuntimeDescriptor | null;

    if (!d || !d.schemaName || !d.resources?.length) {
      return this.report(true, 100, [
        { name: '后端数据服务', passed: true, score: 100, weight: 10, detail: '该应用无数据后端，跳过' },
      ]);
    }

    // 按底座分流（ADR-0009 ③）：若依项目走 RuoyiRuntime 探活，不套 CrudRuntime(路B) 的 schema-IDENT 规则
    const runtime: BackendRuntime = d.kind === 'ruoyi' ? this.ruoyi : this.backend;
    let health;
    try {
      health = await runtime.health(projectId, d);
    } catch (e) {
      this.logger.warn(`后端健康检查失败 (project ${projectId}): ${e instanceof Error ? e.message : e}`);
      return this.report(false, 0, [
        { name: '后端数据服务', passed: false, score: 0, weight: 10, detail: `健康检查失败: ${e instanceof Error ? e.message : e}` },
      ]);
    }

    const checks: SensorCheck[] = d.resources.map((r) => {
      const h = health.resources.find((x) => x.name === r);
      const reachable = !!h?.reachable;
      return {
        name: `数据资源 ${r}`,
        passed: reachable,
        score: reachable ? 100 : 0,
        weight: 10,
        detail: reachable ? '可读写' : h?.detail || '不可达',
      };
    });
    const score = Math.round(checks.reduce((s, c) => s + c.score, 0) / checks.length);
    return this.report(health.healthy, score, checks);
  }

  private report(passed: boolean, score: number, checks: SensorCheck[]): SensorReport {
    return { sensorName: 'L2-后端连通', layer: 2, passed, score, checks };
  }
}
