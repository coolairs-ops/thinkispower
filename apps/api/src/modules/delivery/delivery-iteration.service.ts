import { Injectable, NotFoundException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { Subject, ReplaySubject, Observable } from 'rxjs';
import { PrismaService } from '../../database/prisma.service';
import { HermesClient } from '../../integrations/hermes/hermes.client';
import { QualityGateService } from '../../services/quality-gate.service';
import { DeepseekService } from '../../services/deepseek.service';
import { SensorService } from '../../sensors/sensor.service';
import { IterativeOptimizerService } from '../../services/iterative-optimizer.service';
import { FusedReport, SensorReport } from '../../sensors/sensor-report.interface';
import { DeliveryService } from './delivery.service';

@Injectable()
export class DeliveryIterationService {
  private readonly logger = new Logger(DeliveryIterationService.name);
  private iterateSubjects = new Map<string, Subject<any>>();

  constructor(
    private prisma: PrismaService,
    private hermes: HermesClient,
    private qualityGate: QualityGateService,
    private deepseek: DeepseekService,
    private sensorService: SensorService,
    private optimizer: IterativeOptimizerService,
  ) {}

  /** 启动自动迭代优化（IterativeOptimizer 包装） */
  async startAutoOptimize(projectId: string): Promise<string> {
    return this.optimizer.start(projectId);
  }

  subscribeOptimize(taskId: string) {
    return this.optimizer.subscribe(taskId);
  }

  /** 启动自迭代循环 — 使用数据库全局锁保证全局唯一 */
  async startAutoIterate(projectId: string): Promise<{ taskId: string }> {
    const lock = await this.prisma.systemLock.findUnique({
      where: { id: 'auto_iteration' },
      include: { project: { select: { name: true } } },
    });

    if (lock && lock.projectId !== projectId) {
      const age = Date.now() - lock.createdAt.getTime();
      if (age > 30 * 60 * 1000) {
        this.logger.warn(`[autoIterate] 清除陈旧全局锁 (${Math.round(age / 1000)}s 前)`);
        await this.prisma.systemLock.delete({ where: { id: 'auto_iteration' } });
      } else {
        throw new ConflictException(`项目「${lock.project.name}」正在迭代中，请等待其完成`);
      }
    }

    if (lock?.taskId) {
      const oldSub = this.iterateSubjects.get(lock.taskId);
      if (oldSub) { oldSub.complete(); this.iterateSubjects.delete(lock.taskId); }
    }

    const taskId = `ai-${projectId.substring(0, 8)}-${Date.now().toString(36)}`;
    const subject = new ReplaySubject<any>(100);
    this.iterateSubjects.set(taskId, subject);

    await this.prisma.systemLock.upsert({
      where: { id: 'auto_iteration' },
      create: { id: 'auto_iteration', projectId, taskId },
      update: { projectId, taskId },
    });
    this.logger.log(`[autoIterate] 全局锁已获取: 项目 ${projectId}, taskId ${taskId}`);

    this.runAutoIterate(taskId, projectId, subject).catch(e => {
      this.logger.error(`autoIterate failed: ${e}`, e instanceof Error ? e.stack : '');
      if (!subject.closed) { subject.next({ type: 'error', message: String(e) }); subject.complete(); }
    });

    return { taskId };
  }

  /** 查询全局迭代状态 */
  async getAutoIterateStatus(projectId: string): Promise<{
    active: boolean; taskId?: string;
    currentProjectId?: string; currentProjectName?: string; startedAt?: string;
  }> {
    const lock = await this.prisma.systemLock.findUnique({
      where: { id: 'auto_iteration' },
      include: { project: { select: { name: true } } },
    });
    if (!lock) return { active: false };

    const taskAlive = this.iterateSubjects.has(lock.taskId);
    return {
      active: taskAlive,
      taskId: taskAlive ? lock.taskId : undefined,
      currentProjectId: lock.projectId,
      currentProjectName: lock.project.name,
      startedAt: lock.createdAt.toISOString(),
    };
  }

  /** 强制停止当前项目的自迭代 */
  async stopAutoIterate(projectId: string): Promise<{ stopped: boolean; message: string }> {
    const lock = await this.prisma.systemLock.findUnique({
      where: { id: 'auto_iteration' },
    });
    if (!lock || lock.projectId !== projectId) {
      return { stopped: false, message: '当前项目没有正在运行的迭代' };
    }
    const sub = this.iterateSubjects.get(lock.taskId);
    if (sub && !sub.closed) { sub.next({ type: 'stopped', message: '用户手动停止' }); sub.complete(); }
    this.iterateSubjects.delete(lock.taskId);
    await this.prisma.systemLock.delete({ where: { id: 'auto_iteration' } }).catch(() => {});
    this.logger.log(`[autoIterate] 用户手动停止: 项目 ${projectId}, taskId ${lock.taskId}`);
    return { stopped: true, message: '已停止' };
  }

  /** 订阅自迭代进度 */
  subscribeAutoIterate(taskId: string): Observable<any> | null {
    return this.iterateSubjects.get(taskId)?.asObservable() ?? null;
  }

  /** 用户决策后继续迭代 */
  async decideAutoIterate(projectId: string, decision: 'accept' | 'continue' | 'view_demo'): Promise<any> {
    if (decision === 'accept' || decision === 'view_demo') {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'completed' },
      });
      return { decision, message: decision === 'accept' ? '已采纳当前结果' : '查看 Demo' };
    }
    return { decision, message: '继续迭代，请重新启动' };
  }

  // ─── 内部实现 ───

  private async runAutoIterate(taskId: string, projectId: string, subject: Subject<any>) {
    try {
      const MAX_ROUNDS = 10;
      const STUCK_LIMIT = 3;
      let prevScore = -1;
      let stuckCount = 0;
      let fixFailCount = 0;  // 连续修复失败计数
      const history: any[] = [];

      const phaseDefs = [
        { id: 'sense-l1', label: 'L1 静态分析', color: '#3b82f6' },
        { id: 'sense-l2', label: 'L2 运行时',   color: '#22c55e' },
        { id: 'sense-l3', label: 'L3 语义评估', color: '#a855f7' },
        { id: 'fix',       label: '定向修复',   color: '#f97316' },
        { id: 'decide',    label: '达标判定',   color: '#14b8a6' },
      ];
      const pushPhase = (activeId: string, doneIds: string[]) => {
        subject.next({
          type: 'phase_update',
          phases: phaseDefs.map(p => ({
            ...p,
            status: p.id === activeId ? 'active' : doneIds.includes(p.id) ? 'done' : 'pending',
          })),
        });
      };

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { demoHtml: true, planSummary: true, description: true, structuredRequirement: true },
        });
        if (!project) { subject.next({ type: 'error', message: '项目不存在' }); break; }

        // ── SENSE ──
        subject.next({ type: 'round', round, phase: 'sense', message: `第${round}轮传感器分析...` });
        pushPhase('sense-l1', []);
        const doneSensorPhases: string[] = [];
        let fused: FusedReport;
        try {
          fused = await DeliveryService.withTimeout(
            this.sensorService.runAll(projectId, (phaseId) => {
              doneSensorPhases.push(phaseId);
              const order = ['sense-l1', 'sense-l2', 'sense-l3'];
              const idx = order.indexOf(phaseId);
              if (idx >= 0 && idx < order.length - 1) {
                pushPhase(order[idx + 1], order.slice(0, idx + 1));
              }
            }),
            90000,
            `第${round}轮传感器融合`,
          );
        } catch (e) {
          this.logger.warn(`第${round}轮传感器超时/失败，使用降级评分: ${e}`);
          subject.next({ type: 'round', round, phase: 'sense', message: `第${round}轮传感器超时，使用降级评分` });
          const quickReports: SensorReport[] = [];
          const quickProject = await this.prisma.project.findUnique({
            where: { id: projectId },
            select: { demoHtml: true, planSummary: true, description: true },
          });
          if (quickProject?.demoHtml) {
            try {
              const analysis = await DeliveryService.withTimeout(
                this.hermes.analyzeSilent(projectId, quickProject.demoHtml, quickProject.planSummary, quickProject.description),
                45000,
                '降级语义分析',
              );
              const score = analysis?.completeness ?? 50;
              quickReports.push({
                sensorName: 'L3-语义评估(降级)', layer: 3,
                passed: score >= 60,
                score,
                checks: [{ name: '降级语义评估', passed: true, score, weight: 100, detail: '传感器超时后的降级评估' }],
              });
            } catch {}
          }
          const l3score = quickReports.find(r => r.layer === 3)?.score ?? 0;
          const degRecommendations = quickReports.flatMap(r => r.checks.filter(c => !c.passed).map(c => `${r.sensorName}/${c.name}: ${c.detail || '未通过'}`));
          fused = {
            overallScore: l3score, layer1Score: 0, layer2Score: 0, layer3Score: l3score,
            passed: l3score >= 70, reports: quickReports, recommendations: degRecommendations, stopIteration: false,
          };
        }

        let coverage = 100;
        for (const report of fused.reports) {
          if (report.sensorName === 'TraceabilityValidator') coverage = report.score;
        }

        const score = fused.overallScore;
        history.push({ round, score, l1: fused.layer1Score, l2: fused.layer2Score, l3: fused.layer3Score, coverage });

        const totalChecks = fused.reports.reduce((s, r) => s + r.checks.length, 0);
        const passedChecks = fused.reports.reduce((s, r) => s + r.checks.filter(c => c.passed).length, 0);

        pushPhase('sense-l3', ['sense-l1', 'sense-l2']);

        subject.next({
          type: 'round_result',
          round,
          overallScore: score,
          l1Score: fused.layer1Score,
          l2Score: fused.layer2Score,
          l3Score: fused.layer3Score,
          coverage,
          missingRequirements: [],
          hallucinations: [],
          recommendations: this.sanitizeRecommendations(fused.recommendations),
          passedChecks,
          totalChecks,
          stopIteration: fused.stopIteration,
        });

        // ── FIX ──
        let fixSucceeded = false;
        if (fused.recommendations.length > 0) {
          pushPhase('fix', ['sense-l1', 'sense-l2', 'sense-l3']);
          subject.next({ type: 'round', round, phase: 'fix', message: `第${round}轮定向修复...` });
          try {
            const newDemo = await DeliveryService.withTimeout(
              this.autoFix(projectId, fused.recommendations),
              60000,
              `第${round}轮自动修复`,
            );
            if (newDemo) {
              await this.prisma.project.update({
                where: { id: projectId },
                data: { demoHtml: newDemo },
              });
              fixSucceeded = true;
              fixFailCount = 0; // 成功后重置
            }
          } catch (e) {
            this.logger.warn(`autoFix round ${round} failed: ${e}`);
          }

          if (!fixSucceeded) {
            fixFailCount++;
            subject.next({ type: 'fix_failed', round, fixFailCount, maxFixes: 3,
              message: `自动修复失败 (${fixFailCount}/3)` });
          }
        }

        // ── DECIDE ──
        // 连续3次修复失败 → 需要人工介入
        if (fixFailCount >= 3) {
          pushPhase('decide', ['sense-l1', 'sense-l2', 'sense-l3', 'fix']);
          const msg = `自动修复已连续失败 ${fixFailCount} 次，需要人工介入诊断`;
          this.logger.warn(msg);
          try {
            await this.prisma.project.update({
              where: { id: projectId },
              data: { status: 'paused', publicStatusLabel: '需要人工介入' },
            });
          } catch {}
          subject.next({ type: 'needs_human', round, fixFailCount, message: msg });
          subject.complete();
          return;
        }

        if (fused.stopIteration && score >= 90) {
          pushPhase('decide', ['sense-l1', 'sense-l2', 'sense-l3', 'fix']);
          subject.next({ type: 'done', reason: '达标', score, rounds: round, history });
          subject.complete();
          break;
        }

        if (fused.stopIteration && score < 90) {
          pushPhase('decide', ['sense-l1', 'sense-l2', 'sense-l3', 'fix']);
          subject.next({
            type: 'stuck',
            round, score, prevScore,
            stuckCount: STUCK_LIMIT, history,
            message: '传感器建议停止迭代，当前评分未达标，请决策',
          });
          subject.complete();
          return;
        }

        if (round > 1) {
          if (score <= prevScore) {
            stuckCount++;
            subject.next({ type: 'stuck_progress', round, stuckCount, stuckLimit: STUCK_LIMIT });
            if (stuckCount >= STUCK_LIMIT) {
              pushPhase('decide', ['sense-l1', 'sense-l2', 'sense-l3', 'fix']);
              subject.next({ type: 'stuck', round, score, prevScore, stuckCount, history, message: '连续3轮无改善' });
              subject.complete();
              return;
            }
          } else {
            stuckCount = 0;
          }
        }
        prevScore = score;

        await new Promise(r => setTimeout(r, 1500));
      }

      const last = history[history.length - 1];
      pushPhase('decide', ['sense-l1', 'sense-l2', 'sense-l3', 'fix']);
      subject.next({ type: 'done', reason: '达到最大轮数', score: last?.score ?? 0, rounds: history.length, history });
      subject.complete();
    } finally {
      this.iterateSubjects.delete(taskId);
      await this.clearIterationLock(projectId, taskId);
    }
  }

  /** 过滤内部传感器诊断，转为用户可读的优化建议 */
  private sanitizeRecommendations(raw: string[]): string[] {
    return raw
      .map(r => {
        // 去掉传感器名前缀: "L1-静态分析/XXX: ..." → "XXX: ..."
        let cleaned = r.replace(/^L\d+-[^/]+\//, '');

        // 过滤 N8N 相关（已移除）
        if (/n8n/i.test(cleaned)) return null;

        // 过滤 JSON 解析错误
        if (/Unexpected end of JSON|Empty response/i.test(cleaned)) return null;

        // 翻译常见内部消息
        const translations: [RegExp, string][] = [
          [/HTML结构:?\s*未通过/, '页面结构需要优化'],
          [/HTML结构检查:?\s*未通过/, '页面结构需要优化'],
          [/Demo完整性.*?(\d+)%/, 'Demo 完整度为 $1%'],
          [/完整度.*?(\d+)%/, '整体完整度 $1%'],
          [/数据库连接.*/, '数据库连接异常，请检查服务状态'],
          [/API.*超时/, '服务响应超时，请稍后重试'],
          [/不可用.*降级/, '部分服务暂不可用，已自动降级'],
          [/未通过/i, '需要优化'],
        ];
        for (const [pattern, replacement] of translations) {
          if (pattern.test(cleaned)) {
            return cleaned.replace(pattern, replacement);
          }
        }

        // 进一步清理: 去掉技术细节后缀
        cleaned = cleaned.replace(/\s*\(.*\)$/, '');
        cleaned = cleaned.replace(/:\s*$/, '');

        return cleaned || null;
      })
      .filter((r): r is string => r !== null && r.length > 0);
  }

  private async autoFix(projectId: string, recommendations: string[]): Promise<string | null> {
    if (recommendations.length === 0) return null;

    const topRecs = recommendations.filter(r => !r.includes('整体质量')).slice(0, 5);
    if (topRecs.length === 0) return null;

    // 读取当前 Demo HTML
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true },
    });
    const currentHtml = project?.demoHtml || '';
    if (!currentHtml || currentHtml.length < 200) {
      this.logger.warn(`autoFix 无有效Demo HTML (${currentHtml.length} bytes)，跳过`);
      return null;
    }

    // 截断过长的HTML（保留头尾关键部分）
    const maxHtmlLen = 20000;
    const htmlSnippet = currentHtml.length > maxHtmlLen
      ? currentHtml.slice(0, maxHtmlLen * 0.7) + '\n<!-- ...截断... -->\n' + currentHtml.slice(-maxHtmlLen * 0.3)
      : currentHtml;

    const fixPrompt = `请修复以下 Demo HTML 中的问题，输出完整的修复后 HTML。

当前 HTML：
\`\`\`html
${htmlSnippet}
\`\`\`

修复建议：
${topRecs.join('\n')}

要求：
1. 保持原有结构和功能不变
2. 只修改有问题的部分
3. 不要删除正常功能
4. 输出完整HTML，用 \`\`\`html 包裹`;

    try {
      const response = await this.deepseek.chat(
        [{ role: 'user', content: fixPrompt }],
        { temperature: 0.2, maxTokens: 16384 },
      );
      const htmlMatch =
        response.match(/```html?\s*([\s\S]*?)```/) ||
        response.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
      const result = htmlMatch ? htmlMatch[1].trim() : response.trim();
      if (result.length < 500 || !/<(html|body|div|head)/i.test(result)) {
        this.logger.warn(`autoFix 生成结果无效 (${result.length} bytes)，跳过本轮修复`);
        return null;
      }
      this.logger.log(`autoFix 生成 ${result.length} bytes`);
      return result;
    } catch (e) {
      this.logger.warn(`autoFix failed: ${e}`);
      return null;
    }
  }

  private async clearIterationLock(projectId: string, taskId: string): Promise<void> {
    try {
      const lock = await this.prisma.systemLock.findUnique({ where: { id: 'auto_iteration' } });
      if (lock?.projectId === projectId && lock?.taskId === taskId) {
        await this.prisma.systemLock.delete({ where: { id: 'auto_iteration' } });
        this.logger.log(`[autoIterate] 全局锁已释放: 项目 ${projectId}`);
      }
    } catch (e) {
      this.logger.warn(`[autoIterate] 释放锁时异常: ${e}`);
    }
  }
}
