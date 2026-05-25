import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { TaskService } from '../../modules/task/task.service';
import { CloudecodeClient } from '../cloudecode/cloudecode.client';
import { PrismaService } from '../../database/prisma.service';
import { HtmlValidatorService } from '../../services/html-validator.service';
import { ErrorMatcherService } from '../../services/error-matcher.service';
import { HtmlModuleExtractorService } from '../../services/html-module-extractor.service';
import { DemoSnapshotService } from '../../modules/demo-snapshot/demo-snapshot.service';
import { EVENTS, TasksCreatedPayload, TasksCompletedPayload } from '../../events/event-types';

const BACKOFF_MS = [1000, 2000, 4000];

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private taskService: TaskService,
    private cloudecode: CloudecodeClient,
    private prisma: PrismaService,
    private validator: HtmlValidatorService,
    private errorMatcher: ErrorMatcherService,
    private htmlExtractor: HtmlModuleExtractorService,
    private demoSnapshotService: DemoSnapshotService,
  ) {}

  @OnEvent(EVENTS.TASKS_CREATED)
  async handleTasksCreated(payload: TasksCreatedPayload) {
    this.logger.log(`Pipeline received tasks.created for project ${payload.projectId}`);

    const tasks = await this.taskService.getPendingTasks(payload.projectId);
    if (tasks.length === 0) {
      this.logger.warn(`No pending tasks found for project ${payload.projectId}`);
      return;
    }

    for (const task of tasks) {
      await this.executeTask(task.id, payload.projectId, payload.feedbackId);
    }

    // All done — read updated demoHtml
    const project = await this.prisma.project.findUnique({
      where: { id: payload.projectId },
      select: { demoHtml: true },
    });

    const completedPayload: TasksCompletedPayload = {
      projectId: payload.projectId,
      feedbackId: payload.feedbackId,
      newHtml: project?.demoHtml || undefined,
    };

    this.eventEmitter.emit(EVENTS.TASKS_COMPLETED, completedPayload);
    this.logger.log(`Pipeline completed all tasks for project ${payload.projectId}`);
  }

  /**
   * 执行单个 Task，包含验证 → 重试 → 回滚循环。
   */
  private async executeTask(taskId: string, projectId: string, feedbackId: string) {
    this.logger.log(`Executing task ${taskId}`);

    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        // 1. 执行修改
        await this.taskService.updateStatus(taskId, 'running');
        const result = await this.cloudecode.executeTask(taskId);

        if (!result.success) {
          throw new Error(result.rawError || '执行失败');
        }

        // 2. 读取修改后的 HTML
        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { demoHtml: true },
        });
        if (!project?.demoHtml) throw new Error('修改后 HTML 为空');

        // 3. 验证
        const validation = await this.runValidations(project.demoHtml, taskId);

        if (validation.passed) {
          // 全部通过 → 完成
          await this.taskService.updateStatus(taskId, 'completed', {
            resultPayload: { summary: result.summary, changedFiles: result.changedFiles },
          });
          await this.logDecision(taskId, projectId, 'p3_verify', { success: true });
          return;
        }

        // 4. 验证失败 → 记录错误
        const errorText = validation.errors.join('; ');
        this.logger.warn(`Task ${taskId} 验证失败 (attempt ${attempt}): ${errorText}`);

        const match = await this.errorMatcher.matchError(errorText);
        await this.errorMatcher.recordError({
          projectId,
          taskId,
          rawError: errorText,
          patternId: match?.pattern?.id,
          stage: 'p3_verify',
          actionTaken: attempt < 3 ? 'retry' : 'exhausted',
        });

        // 5. 还有重试机会 → 回滚 + 重试
        if (attempt < 3) {
          await this.rollbackToPreModification(projectId, taskId);
          await this.sleep(this.getBackoff(attempt));
          await this.taskService.updateStatus(taskId, 'pending');
          await this.logDecision(taskId, projectId, 'p3_retry', {
            attempt,
            error: errorText,
            fixHint: match ? this.errorMatcher.buildFixPrompt(match.pattern, errorText) : undefined,
          });
          continue;
        }

        // 6. 重试耗尽 → 最终回滚
        await this.rollbackToPreModification(projectId, taskId);
        await this.taskService.updateStatus(taskId, 'failed', { errorMessage: errorText });
        await this.logDecision(taskId, projectId, 'p3_exhausted', { attempts: attempt + 1 });
        this.eventEmitter.emit(EVENTS.TASK_FAILED, { projectId, feedbackId, taskId, error: errorText });
        return;

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Task ${taskId} 执行错误 (attempt ${attempt}): ${msg}`);

        if (attempt < 3) {
          await this.sleep(this.getBackoff(attempt));
          continue;
        }

        // 重试耗尽
        await this.taskService.updateStatus(taskId, 'failed', { errorMessage: msg });
        await this.logDecision(taskId, projectId, 'p3_exhausted', { attempts: attempt + 1, error: msg });
        this.eventEmitter.emit(EVENTS.TASK_FAILED, { projectId, feedbackId, taskId, error: msg });
        return;
      }
    }
  }

  /**
   * 运行所有验证检查。
   */
  private async runValidations(
    demoHtml: string,
    taskId: string,
  ): Promise<{ passed: boolean; errors: string[] }> {
    const task = await this.taskService.findById(taskId);
    if (!task) return { passed: true, errors: [] };

    const moduleKey = (task.inputPayload as any)?.moduleKey as string | undefined;
    const criteria = (task.inputPayload as any)?.acceptanceCriteria as string[] | undefined;

    // 获取修改前的原始 HTML
    const originalHtml = await this.getPreModificationHtml(task.projectId, taskId);

    const allErrors: string[] = [];

    // 结构性检查
    const structResult = this.validator.validateStructure(
      originalHtml || '',
      demoHtml,
      moduleKey || '',
    );
    if (!structResult.passed) allErrors.push(...structResult.errors);

    // 回归检查
    if (moduleKey && originalHtml) {
      const regressionResult = this.validator.checkRegression(originalHtml, demoHtml, moduleKey);
      if (!regressionResult.passed) {
        allErrors.push(`以下模块被意外修改: ${regressionResult.changedModules.join(', ')}`);
      }
    }

    // 验收标准验证
    if (criteria && criteria.length > 0 && moduleKey) {
      const moduleContent = this.htmlExtractor.extractRenderContent(demoHtml, moduleKey);
      if (moduleContent) {
        const criteriaResult = await this.validator.validateAcceptanceCriteria(moduleContent, criteria);
        if (!criteriaResult.passed) {
          const failed = criteriaResult.criteriaResults
            .filter((r) => !r.passed)
            .map((r) => `验收未通过: ${r.criterion}`);
          allErrors.push(...failed);
        }
      }
    }

    return { passed: allErrors.length === 0, errors: allErrors };
  }

  /**
   * 获取修改前的 HTML 快照（最近一条关联该 taskId 的 pipeline_execute 快照）。
   */
  private async getPreModificationHtml(
    projectId: string,
    taskId: string,
  ): Promise<string | null> {
    const snapshot = await this.prisma.demoSnapshot.findFirst({
      where: { projectId, taskId, source: 'pipeline_execute' },
      orderBy: { createdAt: 'desc' },
      select: { html: true },
    });
    return snapshot?.html || null;
  }

  /**
   * 回滚到修改前状态。
   * 找到关联该 taskId 的最新 pipeline_execute 快照，回滚到该版本。
   */
  private async rollbackToPreModification(
    projectId: string,
    taskId: string,
  ): Promise<void> {
    const snapshot = await this.prisma.demoSnapshot.findFirst({
      where: { projectId, taskId, source: 'pipeline_execute' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (snapshot) {
      await this.demoSnapshotService.rollback(projectId, snapshot.id);
      this.logger.log(`Task ${taskId} 已回滚到快照 ${snapshot.id}`);
    } else {
      this.logger.warn(`Task ${taskId} 未找到可回滚的快照`);
    }
  }

  private async logDecision(
    taskId: string,
    projectId: string,
    stage: string,
    result: Record<string, any>,
  ): Promise<void> {
    try {
      await this.prisma.decisionLog.create({
        data: {
          projectId,
          taskId,
          stage,
          inputContext: {},
          decisionResult: result,
          actionTaken: stage,
          outcome: result.success !== false ? 'success' : 'failed',
        },
      });
    } catch (error) {
      this.logger.error(`记录 DecisionLog 失败: ${error}`);
    }
  }

  private getBackoff(attempt: number): number {
    return BACKOFF_MS[attempt] ?? 4000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
