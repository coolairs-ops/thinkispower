import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import { HermesClient } from '../integrations/hermes/hermes.client';
import { CloudecodeClient } from '../integrations/cloudecode/cloudecode.client';
import { QualityGateService } from './quality-gate.service';
import { PrismaService } from '../database/prisma.service';
import { DeepseekService } from './deepseek.service';
import { CompileValidator } from '../sensors/compile-validator.service';
import { CrossValidator } from '../sensors/cross-validator.service';
import { TraceabilityValidator } from '../sensors/traceability-validator.service';
import { ScreenshotComparator } from '../sensors/screenshot-comparator.service';
import { SensorFusionService } from '../sensors/sensor-fusion.service';
import { L1StaticSensor } from '../sensors/l1-static.sensor';
import { L2RuntimeSensor } from '../sensors/l2-runtime.sensor';
import { L3SemanticSensor } from '../sensors/l3-semantic.sensor';
import { FusedReport, SensorReport } from '../sensors/sensor-report.interface';

export interface IterationRound {
  round: number;
  completeness: number; qualityScore: number; featureScore: number; mixedScore: number;
  riskCount: number; fixesApplied: number;
  status: 'running' | 'success' | 'failed';
  summary: string;
  fusedScore?: number;
  layer1Score?: number;
  layer2Score?: number;
  layer3Score?: number;
}

@Injectable()
export class IterativeOptimizerService {
  private readonly logger = new Logger(IterativeOptimizerService.name);
  private activeOptimizations = new Map<string, Subject<any>>();
  /** 按 projectId 追踪最近的 html，供截图对比做 baseline */
  private htmlBaselines = new Map<string, string>();

  constructor(
    private hermes: HermesClient,
    private cloudecode: CloudecodeClient,
    private qualityGate: QualityGateService,
    private prisma: PrismaService,
    private deepseek: DeepseekService,
    private compileValidator: CompileValidator,
    private crossValidator: CrossValidator,
    private traceabilityValidator: TraceabilityValidator,
    private screenshotComparator: ScreenshotComparator,
    private sensorFusion: SensorFusionService,
    private l1Static: L1StaticSensor,
    private l2Runtime: L2RuntimeSensor,
    private l3Semantic: L3SemanticSensor,
  ) {}

  /** 启动自动迭代优化（含并发控制：同一 project 的旧优化会被停止） */
  async start(projectId: string): Promise<string> {
    // 并发控制：停止同一 project 的已有优化
    for (const [tid, sub] of this.activeOptimizations) {
      if (tid.endsWith(`-${projectId.substring(0, 8)}`)) {
        this.logger.warn(`检测到 project ${projectId} 已有活跃优化 ${tid}，停止旧任务`);
        sub.complete();
        this.activeOptimizations.delete(tid);
      }
    }

    const subject = new Subject<any>();
    // taskId 包含 projectId 前缀以便并发检测
    const taskId = `${projectId.substring(0, 8)}-opt-${Date.now()}`;
    this.activeOptimizations.set(taskId, subject);

    this.runOptimizationLoop(taskId, projectId, subject).catch(e => {
      this.logger.error(`优化循环失败: ${e}`);
      subject.next({ type: 'error', message: '优化过程出错' });
      subject.complete();
    });

    return taskId;
  }

  /** 订阅优化进度 */
  subscribe(taskId: string): Subject<any> | null {
    return this.activeOptimizations.get(taskId) || null;
  }

  /** 停止优化 */
  stop(taskId: string) {
    const sub = this.activeOptimizations.get(taskId);
    if (sub) { sub.complete(); this.activeOptimizations.delete(taskId); }
  }

  private async runOptimizationLoop(taskId: string, projectId: string, subject: Subject<any>) {
    const maxRounds = 10;
    const targetScore = 85;
    const rounds: IterationRound[] = [];

    for (let round = 1; round <= maxRounds; round++) {
      subject.next({ type: 'round_start', round, message: `第${round}轮评估...` });
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { demoHtml: true, planSummary: true, description: true, structuredRequirement: true, backendRuntime: true },
      });
      if (!project?.demoHtml) { subject.next({ type: 'error', message: '无Demo数据' }); break; }

      // ── 传统评估（Hermes 语义分析 + 质量门禁） ──
      const analysis = await this.hermes.analyzeSilent(projectId, project.demoHtml, project.planSummary, project.description);
      const aiScore = analysis?.completeness ?? 0;
      const quality = await this.qualityGate.runAllChecks(projectId, project.demoHtml);
      const featureScore = this.qualityGate.detectFeatures(project.demoHtml);
      const mixedScore = this.qualityGate.computeMixedScore(aiScore, quality.score, featureScore);
      const risks = analysis?.risks || [];

      // ── 客观传感器融合 ──
      const sensorReports: SensorReport[] = [];

      // L1: CompileValidator（语法检查）
      sensorReports.push(await this.compileValidator.validateHtml(project.demoHtml));

      // L1: L1StaticSensor（HTML 结构/标注覆盖率）
      sensorReports.push(await this.l1Static.run(projectId, project.demoHtml));

      // L1: QualityGateService（原有质量门禁）
      sensorReports.push({
        sensorName: 'QualityGateService',
        layer: 1,
        passed: quality.passed,
        score: quality.score,
        checks: quality.checks.map(c => ({
          name: c.name, passed: c.passed,
          score: c.passed ? 100 : 0,
          weight: 100 / quality.checks.length,
          detail: c.detail,
        })),
      });

      // L2: ScreenshotComparator（截图对比，需要 baseline）
      const baseline = this.htmlBaselines.get(projectId);
      if (baseline) {
        sensorReports.push(await this.screenshotComparator.compare(projectId, baseline, project.demoHtml));
      }

      // L2: L2RuntimeSensor（运行环境健康度 — 首轮检查一次即可）
      if (round === 1) {
        sensorReports.push(await this.l2Runtime.run(projectId));
      }

      // L3: CrossValidator（Qwen 交叉验证）
      const planSummaryStr = typeof project.planSummary === 'object'
        ? JSON.stringify(project.planSummary, null, 2)
        : (project.planSummary || '').toString();
      sensorReports.push(await this.crossValidator.validate(projectId, project.demoHtml, planSummaryStr));

      // L3: TraceabilityValidator（需求追溯）
      sensorReports.push(await this.traceabilityValidator.validate(
        projectId, project.demoHtml, project.planSummary, project.structuredRequirement,
        { backendReady: (project.backendRuntime as { status?: string } | null)?.status === 'ready' }, // 已置备若依→后端能力按置备信用(不再拿 demo 误判)
      ));

      // L3: L3SemanticSensor（反馈闭环/项目状态）
      sensorReports.push(await this.l3Semantic.run(projectId));

      // 融合所有传感器
      const fused: FusedReport = this.sensorFusion.fuse(sensorReports);

      const roundData: IterationRound = {
        round, completeness: aiScore, qualityScore: quality.score,
        featureScore, mixedScore,
        fusedScore: fused.overallScore,
        layer1Score: fused.layer1Score,
        layer2Score: fused.layer2Score,
        layer3Score: fused.layer3Score,
        riskCount: risks.length, fixesApplied: 0, status: 'running',
        summary: `混合=${mixedScore}% 融合=${fused.overallScore}% (L1:${fused.layer1Score} L2:${fused.layer2Score} L3:${fused.layer3Score})`,
      };

      subject.next({ type: 'round_progress', data: roundData, message: `完整度 ${fused.overallScore}%`, fused });

      // 2. 检查是否达标
      const primaryScore = fused.overallScore > 0 ? fused.overallScore : mixedScore;
      if (primaryScore >= targetScore || fused.stopIteration) {
        roundData.status = 'success';
        rounds.push(roundData);
        subject.next({ type: 'complete', rounds, message: `到达目标 ${targetScore}% (融合分:${fused.overallScore}%)`, targetReached: true });
        break;
      }

      // 3. 选前 5 个可修复风险（仅来自 Hermes 分析，不含传感器文本建议）
      const topRisks = risks.slice(0, 5).filter((r: any) => r.fixContent);
      if (topRisks.length === 0) {
        roundData.status = 'failed';
        rounds.push(roundData);
        subject.next({ type: 'complete', rounds, message: `没有可修复项 (融合分:${fused.overallScore}%)` });
        break;
      }

      // 4. 修复
      subject.next({ type: 'fixing', round, count: topRisks.length, message: `修复 ${topRisks.length} 项...` });
      const fixesText = topRisks.map((r: any, i: number) => `${i + 1}. ${r.fixTitle}\n   ${r.fixContent}`).join('\n\n');

      try {
        const response = await this.deepseek.chat(
          [{ role: 'user', content: `修改以下HTML：\n\n${fixesText}\n\n输出完整HTML\n\n原始：\n${project.demoHtml.slice(0, 15000)}` }],
          { temperature: 0.3, maxTokens: 16384 },
        );
        const m = response.match(/```html\s*([\s\S]*?)```/) || response.match(/<!DOCTYPE[\s\S]*?<\/html>/i);
        const newHtml = m ? (m[1] || m[0]).replace(/```html\s*/, '').replace(/```$/, '').trim() : '';
        if (newHtml?.includes('<!DOCTYPE')) {
          // 保存当前 html 作为下一轮的 baseline
          this.htmlBaselines.set(projectId, project.demoHtml);
          await this.prisma.project.update({
            where: { id: projectId }, data: { demoHtml: newHtml, status: 'demo_ready' },
          });
          roundData.fixesApplied = topRisks.length;
        }
      } catch (e) {
        this.logger.warn(`第${round}轮修复失败: ${e}`);
      }

      roundData.status = 'success';
      rounds.push(roundData);

      // 5. 连续 2 轮无提升就停
      if (rounds.length >= 2) {
        const prev = rounds[rounds.length - 2].fusedScore ?? rounds[rounds.length - 2].mixedScore;
        const curr = rounds[rounds.length - 1].fusedScore ?? rounds[rounds.length - 1].mixedScore;
        if (curr <= prev) {
          subject.next({ type: 'complete', rounds, message: `连续无提升，停止优化 (${curr}%)`, targetReached: false });
          break;
        }
      }
    }

    subject.complete();
    this.activeOptimizations.delete(taskId);
    this.htmlBaselines.delete(projectId);
  }

  /** 单次评估 */
  async evaluateOnce(projectId: string): Promise<{
    mixedScore: number;
    fused: FusedReport | null;
  }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, planSummary: true, description: true, structuredRequirement: true, backendRuntime: true },
    });
    if (!project?.demoHtml) {
      return { mixedScore: 0, fused: null };
    }

    // 传统评估
    const analysis = await this.hermes.analyzeSilent(projectId, project.demoHtml, project.planSummary, project.description);
    const aiScore = analysis?.completeness ?? 0;
    const quality = await this.qualityGate.runAllChecks(projectId, project.demoHtml);
    const featureScore = this.qualityGate.detectFeatures(project.demoHtml);
    const mixedScore = this.qualityGate.computeMixedScore(aiScore, quality.score, featureScore);

    // 传感器融合评估
    const planSummaryStr = typeof project.planSummary === 'object'
      ? JSON.stringify(project.planSummary, null, 2)
      : (project.planSummary || '').toString();

    const l1Report = await this.compileValidator.validateHtml(project.demoHtml);
    const l1Static = await this.l1Static.run(projectId, project.demoHtml);
    const l3Report = await this.crossValidator.validate(projectId, project.demoHtml, planSummaryStr);
    const traceReport = await this.traceabilityValidator.validate(
      projectId, project.demoHtml, project.planSummary, project.structuredRequirement,
      { backendReady: (project.backendRuntime as { status?: string } | null)?.status === 'ready' },
    );
    const l3Semantic = await this.l3Semantic.run(projectId);

    const fused = this.sensorFusion.fuse([
      l1Report, l1Static,
      {
        sensorName: 'QualityGateService', layer: 1, passed: quality.passed, score: quality.score,
        checks: quality.checks.map(c => ({ name: c.name, passed: c.passed, score: c.passed ? 100 : 0, weight: 100 / quality.checks.length, detail: c.detail })),
      },
      l3Report, traceReport, l3Semantic,
    ]);

    return { mixedScore, fused };
  }
}
