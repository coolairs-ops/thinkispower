import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { TaskService } from '../../modules/task/task.service';
import { CloudecodeClient } from '../cloudecode/cloudecode.client';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';
import { HtmlValidatorService } from '../../services/html-validator.service';
import { ErrorMatcherService } from '../../services/error-matcher.service';
import { HtmlModuleExtractorService } from '../../services/html-module-extractor.service';
import { DemoSnapshotService } from '../../modules/demo-snapshot/demo-snapshot.service';
import { DeploymentService } from '../../modules/deployment/deployment.service';
import { createZipBuffer } from '../../common/utils/zip';
import { EVENTS, TasksCreatedPayload, TasksCompletedPayload } from '../../events/event-types';

const BACKOFF_MS = [1000, 2000, 4000];

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private taskService: TaskService,
    private cloudecode: CloudecodeClient,
    private buildService: BuildService,
    private prisma: PrismaService,
    private validator: HtmlValidatorService,
    private errorMatcher: ErrorMatcherService,
    private htmlExtractor: HtmlModuleExtractorService,
    private demoSnapshotService: DemoSnapshotService,
    private deploymentService: DeploymentService,
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
   * 执行单个 Task。
   * 根据 task.type 路由到不同的执行逻辑：
   * - frontend | backend | database | test | fix → HTML 修改（现有逻辑）
   * - export_* → 导出资产处理
   */
  private async executeTask(taskId: string, projectId: string, feedbackId?: string | null) {
    const task = await this.taskService.findById(taskId);
    if (!task) {
      this.logger.error(`Task ${taskId} not found`);
      return;
    }

    // Export tasks → 导出处理
    if (task.type.startsWith('export_')) {
      await this.handleExportTask(task, projectId);
      return;
    }

    // Deploy task → 部署处理
    if (task.type === 'deploy') {
      await this.handleDeployTask(task, projectId);
      return;
    }

    // HTML 修改任务 → 现有逻辑，包含验证 → 重试 → 回滚循环
    this.logger.log(`Executing HTML modification task ${taskId} type=${task.type}`);

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
   * 处理导出类型任务 (export_source | export_package | export_repository | export_database_schema | export_deployment_config)。
   * 包装现有资产或 AI 生成内容 → 上传 MinIO → 更新 Build 记录。
   */
  private async handleExportTask(task: any, projectId: string) {
    const exportType = task.type.replace('export_', '');
    this.logger.log(`Handling export task ${task.id} type=${task.type} → exportType=${exportType}`);

    await this.taskService.updateStatus(task.id, 'running');

    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { name: true, demoHtml: true, planSummary: true, structuredRequirement: true },
        });
        if (!project) throw new Error(`Project ${projectId} not found`);

        // 找关联的 Build（PipelineService 是降级路径，Build 由 confirmDelivery 预先创建）
        const build = await this.buildService.getLatestBuild(projectId);
        if (!build) {
          throw new Error('No build record found — cannot upload export artifact');
        }

        let buffer: Buffer;
        let filename: string;
        let contentType: string;

        if (task.type === 'export_source' || task.type === 'export_package') {
          // 生成完整项目结构（不再导出 JSON）
          const files = await this.cloudecode.generateProject({
            name: project.name || undefined,
            demoHtml: project.demoHtml,
            planSummary: project.planSummary,
            structuredRequirement: project.structuredRequirement,
          });
          buffer = await createZipBuffer(project.name || 'project', files);
          filename = `${project.name || 'project'}-${exportType}.zip`;
          contentType = 'application/zip';
        } else {
          // AI 生成内容（仓库代码 / 数据库 SQL / 部署配置）
          const result = await this.cloudecode.generateAsset(task.type, {
            planSummary: project.planSummary as string | null,
            structuredRequirement: project.structuredRequirement,
            demoHtml: project.demoHtml,
          });
          buffer = Buffer.from(result.content, 'utf-8');
          filename = result.fileName;
          contentType = result.contentType;
        }

        const url = await this.buildService.uploadArtifact(
          build.id,
          projectId,
          exportType,
          buffer,
          filename,
          contentType,
        );

        await this.taskService.updateStatus(task.id, 'completed', {
          resultPayload: { url, filename, exportType },
        });

        await this.logDecision(task.id, projectId, 'export_complete', {
          success: true,
          exportType,
          url,
          filename,
        });

        this.logger.log(`Export task ${task.id} completed: ${filename} → ${url}`);
        return; // 成功 — 退出循环

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Export task ${task.id} failed (attempt ${attempt}): ${msg}`);

        if (attempt < 3) {
          await this.sleep(this.getBackoff(attempt));
          continue;
        }

        // 重试耗尽
        await this.taskService.updateStatus(task.id, 'failed', { errorMessage: msg });
        await this.logDecision(task.id, projectId, 'export_failed', {
          success: false,
          exportType: task.type,
          error: msg,
        });

        this.eventEmitter.emit(EVENTS.TASK_FAILED, {
          projectId,
          taskId: task.id,
          error: msg,
        });
      }
    }
  }

  /**
   * 处理部署类型任务 — 将当前 demoHtml 部署为不可变快照。
   */
  private async handleDeployTask(task: any, projectId: string) {
    this.logger.log(`Handling deploy task ${task.id} for project ${projectId}`);
    await this.taskService.updateStatus(task.id, 'running');

    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const build = await this.buildService.getLatestBuild(projectId);
        const result = await this.deploymentService.deploy(projectId, build?.id);

        await this.taskService.updateStatus(task.id, 'completed', {
          resultPayload: {
            deploymentId: result.deploymentId,
            productionUrl: result.productionUrl,
          },
        });

        await this.logDecision(task.id, projectId, 'deploy_complete', {
          success: true,
          deploymentId: result.deploymentId,
          productionUrl: result.productionUrl,
        });

        this.logger.log(`Deploy task ${task.id} completed: ${result.productionUrl}`);
        return; // 成功 — 退出循环

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Deploy task ${task.id} failed (attempt ${attempt}): ${msg}`);

        if (attempt < 3) {
          await this.sleep(this.getBackoff(attempt));
          continue;
        }

        // 重试耗尽
        await this.taskService.updateStatus(task.id, 'failed', { errorMessage: msg });
        await this.logDecision(task.id, projectId, 'deploy_failed', {
          success: false,
          error: msg,
        });

        this.eventEmitter.emit(EVENTS.TASK_FAILED, {
          projectId,
          taskId: task.id,
          error: msg,
        });
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
