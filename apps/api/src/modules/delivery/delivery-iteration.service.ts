import { Injectable, NotFoundException, ForbiddenException, ConflictException, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Subject, ReplaySubject, Observable } from 'rxjs';
import { AUTO_ITERATE_QUEUE, AUTO_ITERATE_JOB } from './auto-iterate.queue';
import { PrismaService } from '../../database/prisma.service';
import { SchemaMigrationService } from '../app-runtime/schema-migration.service';
import { buildDataContract, checkContractConformance, normalizeContractForRuntime, contractPromptBlock } from '../app-runtime/app-contract';
import { renderSchema } from '../app-runtime/ui-templates/schema-renderer';
import { injectAppData } from '../app-runtime/ui-templates/appdata-inject';
import { SchemaComposerService } from '../app-runtime/ui-templates/schema-composer.service';
import { AppSchema } from '../app-runtime/ui-templates/page-schema.types';
import { HermesClient } from '../../integrations/hermes/hermes.client';
import { QualityGateService } from '../../services/quality-gate.service';
import { DeepseekService } from '../../services/deepseek.service';
import { SensorService } from '../../sensors/sensor.service';
import { IterativeOptimizerService } from '../../services/iterative-optimizer.service';
import { HtmlModuleExtractorService } from '../../services/html-module-extractor.service';
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
    private htmlExtractor: HtmlModuleExtractorService,
    @InjectQueue(AUTO_ITERATE_QUEUE) private autoIterateQueue: Queue,
    @Optional() private schema?: SchemaMigrationService,
    @Optional() private composer?: SchemaComposerService,
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

    // 入队 BullMQ（取代原 fire-and-forget）：job 持久化于 Redis，进程崩溃后 stalled 机制
    // 重拨续跑，不再留下孤儿锁。attempts=1：循环内部已各有降级/重试，崩溃恢复靠 stalled 重拨。
    // 入队失败要释放刚拿到的锁与内存流，否则前端永远等不到一个不存在的迭代。
    try {
      await this.autoIterateQueue.add(
        AUTO_ITERATE_JOB,
        { taskId, projectId },
        { attempts: 1, removeOnComplete: true, removeOnFail: 50 },
      );
    } catch (e) {
      this.iterateSubjects.delete(taskId);
      await this.clearIterationLock(projectId, taskId);
      this.logger.error(`autoIterate 入队失败，已释放锁: ${e}`, e instanceof Error ? e.stack : '');
      throw e;
    }

    return { taskId };
  }

  /**
   * 查询自迭代状态——以持久 autoIterateState 为真相源（不再依赖内存 Subject），
   * 让前端在流断开后也能对账重建出运行/终态 UI，不会无限挂起。
   */
  async getAutoIterateStatus(projectId: string): Promise<any> {
    const [project, lock] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { autoIterateState: true } }),
      this.prisma.systemLock.findUnique({ where: { id: 'auto_iteration' }, include: { project: { select: { name: true } } } }),
    ]);

    const st = (project?.autoIterateState as any) || null;
    const otherProjectActive = !!lock && lock.projectId !== projectId;
    const base = {
      currentProjectId: lock?.projectId,
      currentProjectName: lock?.project?.name,
      otherProjectActive,
    };

    if (!st) return { active: false, status: 'idle', ...base };

    const subjectAlive = st.taskId ? this.iterateSubjects.has(st.taskId) : false;
    let status: string = st.status;
    let active = status === 'running';
    // 僵尸 running：进程重启等导致内存流已无、且超 3 分钟无更新 → 判为中断（避免前端永远转圈）
    if (active && !subjectAlive) {
      const last = st.updatedAt ? Date.parse(st.updatedAt) : 0;
      if (!last || Date.now() - last > 3 * 60 * 1000) { active = false; status = 'interrupted'; }
    }

    return {
      active,
      status,
      taskId: st.taskId,
      round: st.round ?? 0,
      score: st.score ?? 0,
      rounds: st.rounds || [],
      phases: st.phases || [],
      statusText: st.statusText,
      terminal: st.terminal || null,
      startedAt: st.startedAt,
      updatedAt: st.updatedAt,
      ...base,
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
    // 采纳=推进生命周期到 completed(已采纳/软件已准备好)。注意：这只是生命周期态，
    // 不代表"已上线"——上线由 goLiveStatus(ADR-0009 上线门)单独裁定，采纳不能伪造上线。
    if (decision === 'accept') {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'completed' },
      });
      return { decision, message: '已采纳当前结果' };
    }
    // 仅查看 Demo：不改生命周期状态（看一眼不等于采纳/完成）。
    if (decision === 'view_demo') {
      return { decision, message: '查看 Demo' };
    }
    return { decision, message: '继续迭代，请重新启动' };
  }

  // ─── 内部实现 ───

  /**
   * 执行自迭代长循环（由 AutoIterateProcessor 调用）。
   * Subject 从内存 map 取（startAutoIterate 同进程入队时已建）；崩溃重拨后的 job 在新进程
   * 没有 Subject → emit 仅落库 autoIterateState，前端轮询对账（实时流是延迟优化、非真相源）。
   */
  async executeAutoIterate(taskId: string, projectId: string) {
    const subject = this.iterateSubjects.get(taskId);
    // ── 持久化运行状态（真相源）：每个事件归并进 state 并落库，前端可对账自愈，不依赖内存流 ──
    const state: {
      taskId: string; status: string; round: number; score: number;
      rounds: any[]; phases: any[]; statusText: string; terminal: any; startedAt: string;
    } = { taskId, status: 'running', round: 0, score: 0, rounds: [], phases: [], statusText: '启动自迭代评估', terminal: null, startedAt: new Date().toISOString() };

    let persistChain: Promise<unknown> = Promise.resolve();
    const persist = () => {
      const snap = { ...state, rounds: [...state.rounds], phases: [...state.phases], updatedAt: new Date().toISOString() };
      persistChain = persistChain
        .then(() => this.prisma.project.update({ where: { id: projectId }, data: { autoIterateState: snap as never } }))
        .catch((e) => this.logger.warn(`持久化自迭代状态失败: ${e}`));
      return persistChain;
    };

    // 终态事件类型 → 持久 status（与前端对账映射一致）
    const TERMINAL: Record<string, string> = { needs_human: 'needs_human', stuck: 'awaiting_decision', done: 'done', error: 'error' };
    const emit = (event: { type: string; message?: string; round?: number; overallScore?: number; score?: number; phases?: unknown[]; [k: string]: unknown }) => {
      switch (event.type) {
        case 'round': if (event.round != null) state.round = event.round; if (event.message) state.statusText = event.message; break;
        case 'round_result': state.score = (event.overallScore ?? event.score ?? state.score) as number; state.rounds.push(event); break;
        case 'phase_update': if (event.phases) state.phases = event.phases as unknown[]; break;
        case 'fix_failed': case 'stuck_progress': if (event.message) state.statusText = event.message; break;
        default:
          if (TERMINAL[event.type]) { state.status = TERMINAL[event.type]; state.terminal = event; if (event.message) state.statusText = event.message; }
      }
      if (subject && !subject.closed) subject.next(event);
      persist();
    };

    await persist(); // 初始落库 running

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
        emit({
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
          select: { demoHtml: true, planSummary: true, description: true, structuredRequirement: true, dataModel: true },
        });
        if (!project) { emit({ type: 'error', message: '项目不存在' }); break; }

        // ── SENSE ──
        emit({ type: 'round', round, phase: 'sense', message: `第${round}轮传感器分析...` });
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
          emit({ type: 'round', round, phase: 'sense', message: `第${round}轮传感器超时，使用降级评分` });
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

        emit({
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

        // 前端契约桥（ADR-0003 缺口/ADR-0007 候选）：前端 appData 用了数据模型里没有的资源
        // → 加一条确定性修复建议，进既有 recommendations→autoFix 回路，让迭代朝数据契约收敛。
        if (this.schema && project.dataModel && project.demoHtml) {
          try {
            const contract = buildDataContract(this.schema.parseAndValidate(project.dataModel));
            const conf = checkContractConformance(project.demoHtml, contract);
            if (!conf.ok) {
              fused.recommendations.unshift(
                `数据契约不一致：前端用了不存在的资源「${conf.unknownResources.join('、')}」。` +
                  `appData 资源名只能取：${contract.resources.map((r) => r.name).join('、')}。把越界的 appData 调用改成契约内资源。`,
              );
            }
          } catch (e) {
            this.logger.warn(`契约校验跳过: ${e instanceof Error ? e.message : e}`);
          }
        }

        // ── FIX ──
        let fixSucceeded = false;
        if (fused.recommendations.length > 0) {
          pushPhase('fix', ['sense-l1', 'sense-l2', 'sense-l3']);
          emit({ type: 'round', round, phase: 'fix', message: `第${round}轮定向修复...` });
          try {
            // S5：schema 驱动项目改 schema（结构化、契约校验、绕开"无批注修不动"）；否则/未变 → 回退 HTML 修复
            let newDemo = await DeliveryService.withTimeout(
              this.autoFixViaSchema(projectId, fused.recommendations),
              150000,
              `第${round}轮 schema 修订`,
            );
            if (!newDemo) {
              newDemo = await DeliveryService.withTimeout(
                this.autoFix(projectId, fused.recommendations),
                150000, // 按模块串行修复最多 4 个模块，给足时延余量
                `第${round}轮自动修复`,
              );
            }
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
            emit({ type: 'fix_failed', round, fixFailCount, maxFixes: 3,
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
          emit({ type: 'needs_human', round, fixFailCount, message: msg });
          subject?.complete();
          return;
        }

        if (fused.stopIteration && score >= 90) {
          pushPhase('decide', ['sense-l1', 'sense-l2', 'sense-l3', 'fix']);
          emit({ type: 'done', reason: '达标', score, rounds: round, history });
          subject?.complete();
          break;
        }

        if (fused.stopIteration && score < 90) {
          pushPhase('decide', ['sense-l1', 'sense-l2', 'sense-l3', 'fix']);
          emit({
            type: 'stuck',
            round, score, prevScore,
            stuckCount: STUCK_LIMIT, history,
            message: '传感器建议停止迭代，当前评分未达标，请决策',
          });
          subject?.complete();
          return;
        }

        if (round > 1) {
          if (score <= prevScore) {
            stuckCount++;
            emit({ type: 'stuck_progress', round, stuckCount, stuckLimit: STUCK_LIMIT });
            if (stuckCount >= STUCK_LIMIT) {
              pushPhase('decide', ['sense-l1', 'sense-l2', 'sense-l3', 'fix']);
              emit({ type: 'stuck', round, score, prevScore, stuckCount, history, message: '连续3轮无改善' });
              subject?.complete();
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
      emit({ type: 'done', reason: '达到最大轮数', score: last?.score ?? 0, rounds: history.length, history });
      subject?.complete();
    } finally {
      // 兜底：循环异常退出时也标记终态，避免持久状态停在 running 误导前端
      if (state.status === 'running') { state.status = 'error'; state.terminal = { type: 'error', message: '迭代异常结束' }; persist(); }
      await persistChain; // 确保终态先落库，再释放锁/清理内存流
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

  /**
   * 供守护分级修复复用：对给定建议做一次定向修复，返回新 HTML 或 null（不持久化）。
   * 复用 autoFix（含防退化护栏 + 按模块/整块修复）。
   */
  async runTargetedFix(projectId: string, recommendations: string[]): Promise<string | null> {
    return this.autoFix(projectId, recommendations);
  }

  /**
   * S5：schema 驱动项目的修复——据建议修订 appSchema → renderSchema 重渲染 → 持久 appSchema，返回新 HTML。
   * 结构化修改比改 HTML 字符串健壮（不丢内容/批注）、契约校验防越界、绕开"模板无批注修不动"病根。
   * 非 schema 项目 / 未注入 composer / 修订无变化 → 返回 null（调用方回退到 HTML 版 autoFix）。
   * 仅自迭代回路调用；守护的 runTargetedFix 仍走 autoFix（不触发 appSchema 持久化副作用）。
   */
  private async autoFixViaSchema(projectId: string, recommendations: string[]): Promise<string | null> {
    if (!this.composer || recommendations.length === 0) return null;
    const usefulRecs = recommendations.filter(r => !r.includes('整体质量'));
    if (usefulRecs.length === 0) return null;

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { dataModel: true, backendRuntime: true, appSchema: true },
    });
    const appSchema = (project as { appSchema?: unknown } | null)?.appSchema as AppSchema | undefined;
    if (!appSchema?.pages?.length) return null;

    const backendKind = (project?.backendRuntime as { kind?: string } | null)?.kind;
    const { schema, dropped, changed } = await this.composer.reviseSchema(appSchema, usefulRecs, project?.dataModel, backendKind);
    if (!changed) return null;

    const html = injectAppData(renderSchema(schema), projectId);
    await this.prisma.project.update({ where: { id: projectId }, data: { appSchema: schema } as never });
    this.logger.log(`autoFix(schema) ${projectId}: 修订 ${schema.pages.length}页 丢弃${dropped.length} → ${html.length}b`);
    return html;
  }

  private async autoFix(projectId: string, recommendations: string[]): Promise<string | null> {
    if (recommendations.length === 0) return null;

    const usefulRecs = recommendations.filter(r => !r.includes('整体质量'));
    if (usefulRecs.length === 0) return null;

    // 读取当前 Demo HTML（+ 数据模型/后端类型，供契约先行注入）
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, dataModel: true, backendRuntime: true },
    });
    const currentHtml = project?.demoHtml || '';
    if (!currentHtml || currentHtml.length < 200) {
      this.logger.warn(`autoFix 无有效Demo HTML (${currentHtml.length} bytes)，跳过`);
      return null;
    }

    // 契约先行（ADR-0007）：每次修复 prompt 都带数据契约约束，预防修别的问题时引入新的越界 appData 调用
    //（后验门只在越界后才纠；先验让每轮修复都朝契约收敛）。按 backendRuntime 方言归一。无 schema/模型 → 空串。
    const contractBlock = this.buildContractBlock(project?.dataModel, (project?.backendRuntime as { kind?: string } | null)?.kind);

    // 多模块 SPA：把建议映射到具体模块，逐个在精简上下文里定向修复，突破整块截断/输出上限。
    // 无模块锚点（旧 demo）或建议无法定位到任何模块时，回退到原有整块逻辑，保证不回归。
    const modules = this.htmlExtractor.listModules(currentHtml);
    if (modules.length === 0) {
      return this.autoFixWholeHtml(currentHtml, usefulRecs.slice(0, 5), contractBlock);
    }

    const recsByModule = this.mapRecommendationsToModules(usefulRecs, modules);
    if (recsByModule.size === 0) {
      return this.autoFixWholeHtml(currentHtml, usefulRecs.slice(0, 5), contractBlock);
    }

    const MAX_FIX_MODULES = 4; // 单轮内限制串行 LLM 调用数，控制时延
    const keysToFix = [...recsByModule.keys()].slice(0, MAX_FIX_MODULES);
    let workingHtml = currentHtml;
    let fixedCount = 0;
    for (const key of keysToFix) {
      try {
        const fixed = await this.fixSingleModule(workingHtml, key, recsByModule.get(key)!, contractBlock);
        // mergeModuleContent 仅替换目标模块的 render 内容，全局 script/head/data-theme 不动
        if (fixed && fixed !== workingHtml) {
          workingHtml = fixed;
          fixedCount++;
        }
      } catch (e) {
        this.logger.warn(`autoFix 模块 ${key} 修复失败，跳过: ${e}`);
      }
    }

    if (fixedCount === 0) return null;
    this.logger.log(`autoFix 按模块修复完成 ${fixedCount}/${keysToFix.length} 个模块 (${workingHtml.length} bytes)`);
    return workingHtml;
  }

  /** 把扁平建议按"模块 key/中文 name 是否被提及"归到各模块；无法定位的建议忽略 */
  private mapRecommendationsToModules(
    recommendations: string[],
    modules: { key: string; name: string }[],
  ): Map<string, string[]> {
    const byModule = new Map<string, string[]>();
    for (const rec of recommendations) {
      for (const m of modules) {
        if ((m.name && rec.includes(m.name)) || rec.includes(m.key)) {
          if (!byModule.has(m.key)) byModule.set(m.key, []);
          byModule.get(m.key)!.push(rec);
        }
      }
    }
    return byModule;
  }

  /** 数据模型 → 按底座方言归一的契约 prompt 块（先验注入用）。无 schema/模型/解析失败 → 空串。 */
  private buildContractBlock(dataModel: string | null | undefined, backendKind?: string): string {
    if (!this.schema || !dataModel) return '';
    try {
      const contract = normalizeContractForRuntime(buildDataContract(this.schema.parseAndValidate(dataModel)), backendKind);
      return contractPromptBlock(contract);
    } catch (e) {
      this.logger.warn(`契约块构建跳过: ${e instanceof Error ? e.message : e}`);
      return '';
    }
  }

  /** 定向修复单个模块：精简上下文 → 只改该模块 → 合并回完整 HTML */
  private async fixSingleModule(html: string, moduleKey: string, recs: string[], contractBlock = ''): Promise<string | null> {
    const condensed = this.htmlExtractor.buildCondensedHtml(html, moduleKey);

    const fixPrompt = `请修复以下 Demo HTML 中「data-module-key="${moduleKey}"」这一个模块的问题，输出完整 HTML。

当前 HTML（其余模块已折叠为占位注释，请勿展开或改动它们）：
\`\`\`html
${condensed}
\`\`\`

针对该模块的修复建议：
${recs.join('\n')}
${contractBlock ? `\n${contractBlock}\n` : ''}
要求：
1. 只修改 data-module-key="${moduleKey}" 模块 render() 返回的内容
2. 不要改动全局 <script>（navigate/状态/pages 结构）、<head>、样式与 daisyUI data-theme
3. 不要展开或重写其他模块的占位注释
4. 保持该模块原有结构与功能，只做必要修复
5. 输出完整 HTML，用 \`\`\`html 包裹`;

    const response = await this.deepseek.chat(
      [{ role: 'user', content: fixPrompt }],
      { temperature: 0.2, maxTokens: 8192 },
    );
    const htmlMatch =
      response.match(/```html?\s*([\s\S]*?)```/) ||
      response.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
    const modified = htmlMatch ? htmlMatch[1].trim() : response.trim();
    if (modified.length < 200 || !/data-module-key/i.test(modified)) {
      this.logger.warn(`autoFix 模块 ${moduleKey} 生成结果无效 (${modified.length} bytes)，跳过`);
      return null;
    }
    return this.htmlExtractor.mergeModuleContent(html, modified, moduleKey);
  }

  /** 整块修复（旧逻辑回退）：无模块锚点或建议无法定位时使用 */
  private async autoFixWholeHtml(currentHtml: string, topRecs: string[], contractBlock = ''): Promise<string | null> {
    if (topRecs.length === 0) return null;

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
${contractBlock ? `\n${contractBlock}\n` : ''}
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
      // 防退化护栏：整块修复在 prompt 里截断了 HTML，LLM 易据截断版重写而丢内容/丢批注，
      // 使 L1（批注标注 / 模块覆盖率）越改越差。若结果显著缩水或批注数下降，判为退化、
      // 丢弃本轮（宁可不改，不做负优化）。
      const before = this.countAnnotations(currentHtml);
      const after = this.countAnnotations(result);
      if (result.length < currentHtml.length * 0.85) {
        this.logger.warn(`autoFix 结果显著缩水 (${currentHtml.length}→${result.length} bytes < 85%)，判为退化，丢弃本轮`);
        return null;
      }
      if (after.modules < before.modules || after.elements < before.elements) {
        this.logger.warn(`autoFix 批注退化 (模块 ${before.modules}→${after.modules}, 元素 ${before.elements}→${after.elements})，丢弃本轮`);
        return null;
      }
      this.logger.log(`autoFix 生成 ${result.length} bytes`);
      return result;
    } catch (e) {
      this.logger.warn(`autoFix failed: ${e}`);
      return null;
    }
  }

  /** 统计 L1 关心的批注密度（模块键 + 元素路径），用于整块修复的防退化护栏 */
  private countAnnotations(html: string): { modules: number; elements: number } {
    return {
      modules: (html.match(/data-module-key=/g) || []).length,
      elements: (html.match(/data-element-path=/g) || []).length,
    };
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
