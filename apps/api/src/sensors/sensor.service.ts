import { Injectable, Logger } from '@nestjs/common';
import { L1StaticSensor } from './l1-static.sensor';
import { L2RuntimeSensor } from './l2-runtime.sensor';
import { L3SemanticSensor } from './l3-semantic.sensor';
import { CrossValidator } from './cross-validator.service';
import { TraceabilityValidator } from './traceability-validator.service';
import { BackendSmokeSensor } from './backend-smoke.sensor';
import { PrismaService } from '../database/prisma.service';
import { FusedReport, SensorReport } from './sensor-report.interface';

@Injectable()
export class SensorService {
  private readonly logger = new Logger(SensorService.name);

  constructor(
    private l1: L1StaticSensor,
    private l2: L2RuntimeSensor,
    private l3: L3SemanticSensor,
    private crossValidator: CrossValidator,
    private traceValidator: TraceabilityValidator,
    private prisma: PrismaService,
    private backendSensor: BackendSmokeSensor,
  ) {}

  /**
   * 全平台健康检查 — 对每个项目运行 L1+L2+L3 并融合。
   * 如果项目数量大，建议异步调用。
   */
  async runAll(projectId?: string, onProgress?: (phaseId: string) => void): Promise<FusedReport> {
    const reports: SensorReport[] = [];

    if (projectId) {
      const { demoHtml } = await this.loadProjectDemo(projectId);
      if (demoHtml) {
        try { reports.push(await this.l1.run(projectId, demoHtml)); onProgress?.('sense-l1'); }
        catch (e) { this.logger.warn(`L1 传感器失败: ${e}`); }
      } else {
        this.logger.warn(`项目 ${projectId} 无 demoHtml, 跳过 L1`);
      }
    }

    try {
      reports.push(projectId ? await this.l2.run(projectId) : await this.l2.run());
      onProgress?.('sense-l2');
    } catch (e) {
      this.logger.warn(`L2 传感器失败: ${e}`);
    }

    if (projectId) {
      // 后端连通探活（L2 运行时层，测交付后端本身）：fuse 优先用它作 L2 运行时分(修 #1)，
      // 失败 check 同时进 recommendations 让自迭代看见后端问题。
      try { reports.push(await this.backendSensor.run(projectId)); }
      catch (e) { this.logger.warn(`后端连通传感器失败: ${e}`); }

      try { reports.push(await this.l3.run(projectId)); onProgress?.('sense-l3'); }
      catch (e) { this.logger.warn(`L3 传感器失败: ${e}`); }

      // CrossValidator: Qwen 交叉验证 DeepSeek 输出
      const { demoHtml } = await this.loadProjectDemo(projectId);
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { planSummary: true, structuredRequirement: true, backendRuntime: true },
      });
      // ADR-0008：后端底座（若依）已置备 → backend 类需求按置备信用、不拿 HTML 判
      const backendReady = (project?.backendRuntime as any)?.status === 'ready';
      if (demoHtml) {
        try {
          reports.push(await this.crossValidator.validate(
            projectId, demoHtml,
            typeof project?.planSummary === 'string' ? project.planSummary : JSON.stringify(project?.planSummary || {}),
          ));
        } catch (e) { this.logger.warn(`CrossValidator 失败: ${e}`); }

        try {
          reports.push(await this.traceValidator.validate(
            projectId, demoHtml, project?.planSummary, project?.structuredRequirement,
            { backendReady },
          ));
        } catch (e) { this.logger.warn(`TraceabilityValidator 失败: ${e}`); }
      }
    }

    return this.fuse(reports);
  }

  /**
   * 仅运行 L1 静态检查（轻量，不依赖外部服务）。
   */
  async runL1(projectId: string): Promise<SensorReport | null> {
    const { demoHtml } = await this.loadProjectDemo(projectId);
    if (!demoHtml) return null;
    return this.l1.run(projectId, demoHtml);
  }

  /**
   * 仅运行 L2 运行时检查。
   */
  async runL2(projectId?: string): Promise<SensorReport> {
    return projectId ? this.l2.run(projectId) : this.l2.run();
  }

  /**
   * 仅运行 L3 语义检查。
   */
  async runL3(projectId: string): Promise<SensorReport> {
    return this.l3.run(projectId);
  }

  private async loadProjectDemo(projectId: string): Promise<{ demoHtml: string | null }> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { demoHtml: true },
      });
      return { demoHtml: project?.demoHtml ?? null };
    } catch {
      return { demoHtml: null };
    }
  }

  /**
   * 融合三个传感器的报告。
   * 加权：L1=30%, L2=30%, L3=40%
   */
  private fuse(reports: SensorReport[]): FusedReport {
    const HAS_L1 = reports.some(r => r.layer === 1);
    const HAS_L2 = reports.some(r => r.layer === 2);
    const HAS_L3 = reports.some(r => r.layer === 3);

    const l1Score = reports.find(r => r.layer === 1)?.score ?? 0;
    // L2 运行时分(修 #1)：当项目有真数据后端时，用"交付后端真探活"(L2-后端连通)作运行时分——
    // 它测的是交付程序本身、不可达即据实给低分；无数据后端(探活 skip)则回退平台 L2(L2-运行时状态)。
    // 不再用恒高的平台健康冒充"这个项目可运行"。
    const backendReport = reports.find(r => r.layer === 2 && r.sensorName === 'L2-后端连通');
    const platformL2 = reports.find(r => r.layer === 2 && r.sensorName !== 'L2-后端连通');
    const backendMeasured = !!backendReport?.checks.some(c => c.name.startsWith('数据资源'));
    const l2Score = (backendMeasured ? backendReport : platformL2)?.score ?? backendReport?.score ?? 0;
    const l3Score = reports.find(r => r.layer === 3)?.score ?? 0;

    // 动态权重：只在不存在的层之间均匀分配
    const defaultWeights: Record<number, number> = { 1: 0.3, 2: 0.3, 3: 0.4 };
    const active = [1, 2, 3].filter(l => [HAS_L1, HAS_L2, HAS_L3][l - 1]);
    const baseSum = active.reduce((s, l) => s + defaultWeights[l], 0);
    let weightL1 = 0, weightL2 = 0, weightL3 = 0;
    for (const l of active) {
      const w = defaultWeights[l] / baseSum;
      if (l === 1) weightL1 = w;
      if (l === 2) weightL2 = w;
      if (l === 3) weightL3 = w;
    }

    const overallScore = Math.round(
      l1Score * weightL1 + l2Score * weightL2 + l3Score * weightL3,
    );

    // 收集所有失败的 check 作为建议
    const recommendations: string[] = [];
    let stopIteration = false;

    for (const report of reports) {
      for (const check of report.checks) {
        if (!check.passed) {
          recommendations.push(`${report.sensorName}/${check.name}: ${check.detail || check.error || '未通过'}`);
        }
      }
    }

    // 严重失败导致 stopIteration — 仅 L2 运行时故障（DB/服务不可用）触发，
    // L1 静态分析和 L3 语义评估不应阻断迭代
    const criticalFails = reports
      .filter(r => r.layer === 2)
      .flatMap(r => r.checks)
      .filter(c => !c.passed && c.weight >= 25);
    const isCriticalDbFail = reports.some(r =>
      r.layer === 2 && r.checks.some(c =>
        !c.passed && c.name === '数据库连接',
      ),
    );
    if (criticalFails.length > 0 || isCriticalDbFail) {
      stopIteration = true;
    }

    return {
      overallScore,
      layer1Score: l1Score,
      layer2Score: l2Score,
      layer3Score: l3Score,
      passed: overallScore >= 70,
      reports,
      recommendations,
      stopIteration,
    };
  }
}
