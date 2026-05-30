import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { HermesClient } from '../../integrations/hermes/hermes.client';
import { N8nClient } from '../../integrations/n8n/n8n.client';
import { CaseReviewService } from '../case-review/case-review.service';
import { ExperienceRecommendationService } from '../experience-recommendation/experience-recommendation.service';
import { DeploymentService } from '../deployment/deployment.service';
import { QualityGateService } from '../../services/quality-gate.service';
import { DeepseekService } from '../../services/deepseek.service';
import { DemoService } from '../demo/demo.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { EVENTS, DeliveryExportRequestedPayload, DeliveryExportCompletedPayload, DeliveryExportFailedPayload, ExportType, TasksCreatedPayload, TasksCompletedPayload } from '../../events/event-types';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private eventEmitter: EventEmitter2,
    private buildService: BuildService,
    private statusMapper: StatusMapperService,
    private hermes: HermesClient,
    private n8n: N8nClient,
    private caseReviewService: CaseReviewService,
    private experienceService: ExperienceRecommendationService,
    private deploymentService: DeploymentService,
    private qualityGate: QualityGateService,
    private demoService: DemoService,
    private cloudecodeClient: CloudecodeClient,
    private deepseek: DeepseekService,
  ) {}

  async getDelivery(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { deliveryOptions: true, user: { select: { plan: true } } },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const options = project.deliveryOptions;

    // 获取最新 Build
    const latestBuild = await this.buildService.getLatestBuild(projectId);

    // 读取 Hermes 交付分析结果（如果有）
    const deliveryAnalysis = (project.structuredRequirement as any)?.deliveryAnalysis || null;

    return {
      productionUrl: project.productionUrl,
      adminEmail: null,
      status: project.status,
      publicStatusLabel: project.publicStatusLabel,
      isPro: project.user.plan === 'pro' || project.user.plan === 'enterprise',
      onlineUrlEnabled: options?.onlineUrlEnabled ?? true,
      sourceZipEnabled: options?.sourceZipEnabled ?? false,
      packageExportEnabled: options?.packageExportEnabled ?? false,
      gitRepositoryEnabled: options?.gitRepositoryEnabled ?? false,
      databaseExportEnabled: options?.databaseExportEnabled ?? false,
      deploymentConfigEnabled: options?.deploymentConfigEnabled ?? false,
      deliveryAnalysis, // 状态观测器数据
      latestBuild: latestBuild
        ? {
            id: latestBuild.id,
            version: latestBuild.version,
            status: latestBuild.status,
            sourceZipUrl: latestBuild.sourceZipUrl,
            packageZipUrl: latestBuild.packageZipUrl,
            repositoryUrl: latestBuild.repositoryUrl,
            databaseSchemaUrl: latestBuild.databaseSchemaUrl,
            deploymentConfigUrl: latestBuild.deploymentConfigUrl,
            productionUrl: latestBuild.productionUrl,
            testReport: latestBuild.testReport,
            createdAt: latestBuild.createdAt,
          }
        : null,
    };
  }

  /**
   * 确认交付 — 工程控制论的"控制器启动器"。
   *
   * 不再直接 status = 'completed'，而是触发完整控制回路：
   *   1. Hermes 认知分析（传感器）→ 任务分解 + 风险评估
   *   2. N8N 编排（控制器）→ 调度执行
   *   3. Cloudecode 执行（被控对象）→ 代码生成
   *   4. Webhook 回调（反馈信道）→ 更新状态
   *
   * 降级路径：N8N 不可用时 → PipelineService 本地顺序执行
   */
  async confirmDelivery(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, status: true, user: { select: { plan: true } } },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    this.logger.log(`[控制器] 开始交付流程: 项目 ${projectId}`);

    // ─── 阶段 1：传感器 — Hermes 认知分析 ───
    this.logger.log(`[传感器] Hermes 分析项目交付就绪状态`);
    const { taskIds, analysis } = await this.hermes.handleDeliveryExport(projectId);

    this.logger.log(
      `[传感器] 分析完成: 完整度 ${analysis.completeness}%, ${taskIds.length} 个任务, ${analysis.risks.length} 个风险`,
    );

    // ─── 阶段 2：状态转换 — 标记为交付中 ───
    this.statusMapper.assertValidTransition(project.status, 'exporting');
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'exporting',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('exporting'),
      },
    });

    // ─── 阶段 3：创建 Build 记录 ───
    const build = await this.buildService.createBuild(projectId, 'delivery');

    // ─── 阶段 4：创建代码生成任务并触发执行 ───
    // Hermes 分析任务 ≠ 代码生成任务，需要单独创建导出任务
    const exportTasks = [
      { type: 'export_source', title: '源码导出', description: '生成完整项目源码ZIP包', priority: 90 },
      { type: 'export_package', title: '项目包导出', description: '生成项目包ZIP', priority: 80 },
      { type: 'export_deployment_config', title: '部署配置', description: '生成Docker部署配置', priority: 70 },
    ];

    const createdTasks: string[] = [];
    for (const t of exportTasks) {
      const created = await this.prisma.task.create({
        data: { projectId, type: t.type, title: t.title, description: t.description, priority: t.priority, status: 'pending', inputPayload: { source: 'delivery_confirm' } },
      });
      createdTasks.push(created.id);
    }

    this.logger.log(`[控制器] 创建 ${createdTasks.length} 个导出任务，触发 PipelineService`);

    // 直接触发 PipelineService 本地执行
    const tasksPayload: TasksCreatedPayload = { projectId, taskIds: createdTasks };
    this.eventEmitter.emit(EVENTS.TASKS_CREATED, tasksPayload);

    return {
      success: true,
      status: 'exporting',
      buildId: build.id,
      taskCount: taskIds.length,
      analysis,
    };
  }

  async requestExport(userId: string, projectId: string, exportType: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, status: true, user: { select: { plan: true } } },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    // 免费用户限制
    if (project.user.plan === 'free') {
      return { upgradeRequired: true, message: '高级交付服务需升级套餐' };
    }

    // 1. 创建 Build 记录
    const build = await this.buildService.createBuild(projectId, exportType);

    // 2. 更新项目状态为 exporting（带状态机校验）
    const currentStatus = project.status;
    this.statusMapper.assertValidTransition(currentStatus, 'exporting');
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'exporting',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('exporting'),
      },
    });

    // 3. 发出交付请求事件
    const payload: DeliveryExportRequestedPayload = {
      projectId,
      buildId: build.id,
      exportType: exportType as ExportType,
      userId,
    };
    this.eventEmitter.emit(EVENTS.DELIVERY_EXPORT_REQUESTED, payload);

    this.logger.log(`Export ${exportType} initiated: build ${build.id} for project ${projectId}`);

    return {
      upgradeRequired: false,
      buildId: build.id,
      version: build.version,
      status: 'processing',
      message: '已收到请求，正在处理。',
    };
  }

  /**
   * 检查 N8N 是否可用。
   * 通过 N8N 环境变量判断（实际生产环境应做健康检查）。
   */
  @OnEvent(EVENTS.TASKS_COMPLETED)
  async handleDeliveryTasksCompleted(payload: TasksCompletedPayload) {
    const { projectId } = payload;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });

    if (project?.status === 'exporting') {
      // 更新最新 Build 记录
      const latestBuild = await this.prisma.build.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { id: true },
      });

      // 检查是否已通过 deploy task 部署
      const existingDeployment = await this.prisma.deployment.findFirst({
        where: { projectId, status: 'deployed' },
      });

      let productionUrl: string;
      if (existingDeployment) {
        const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3001');
        productionUrl = `${baseUrl}/api/deploy/${projectId}`;
      } else {
        const deployResult = await this.deploymentService.deploy(projectId, latestBuild?.id);
        productionUrl = deployResult.productionUrl;
      }

      this.statusMapper.assertValidTransition('exporting', 'completed');
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'completed',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('completed'),
          productionUrl,
        },
      });
      if (latestBuild) {
        await this.prisma.build.update({
          where: { id: latestBuild.id },
          data: { status: 'success', productionUrl },
        });
      }

      this.logger.log(`[交付完成] 项目 ${projectId} 交付完成, productionUrl=${productionUrl}`);

      // 异步生成复盘和经验推荐
      this.caseReviewService.generateReview(projectId).then(review => {
        this.logger.log(`[复盘] 项目 ${projectId} 复盘报告已生成`);
      }).catch(err => {
        this.logger.error(`[复盘] 项目 ${projectId} 复盘生成失败: ${err.message}`);
      });

      this.experienceService.generateRecommendations(projectId).then(recs => {
        this.logger.log(`[经验] 项目 ${projectId} 经验推荐已生成: ${recs.length} 条`);
      }).catch(err => {
        this.logger.error(`[经验] 项目 ${projectId} 推荐生成失败: ${err.message}`);
      });
    }
  }

  @OnEvent(EVENTS.DELIVERY_EXPORT_COMPLETED)
  async handleExportCompleted(payload: DeliveryExportCompletedPayload) {
    const { projectId, buildId, exportType } = payload;
    this.logger.log(`[交付] 导出完成: ${exportType} project=${projectId} build=${buildId}`);

    await this.buildService.updateBuildStatus(buildId, 'success');

    if (['source', 'package', 'deployment'].includes(exportType)) {
      this.caseReviewService.generateReview(projectId).catch(err => {
        this.logger.error(`[复盘] 项目 ${projectId} 复盘生成失败: ${err.message}`);
      });
    }
  }

  @OnEvent(EVENTS.DELIVERY_EXPORT_FAILED)
  async handleExportFailed(payload: DeliveryExportFailedPayload) {
    const { projectId, buildId, exportType, error } = payload;
    this.logger.error(`[交付] 导出失败: ${exportType} project=${projectId} build=${buildId}: ${error}`);

    await this.buildService.updateBuildStatus(buildId, 'failed');
  }

  /** 请求评估 — 只分析不交付，返回风险+修复建议 */
  async requestEvaluation(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, status: true, demoHtml: true, planSummary: true, description: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    // 直接调用 DeepSeek 分析（不走 Hermes 避免创建任务）
    let analysis: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        analysis = await this.hermes.analyzeSilent(projectId, project.demoHtml || '', project.planSummary, project.description);
        if (analysis?.risks?.length > 0) break;
      } catch { }
    }

    if (!analysis) {
      analysis = {
        completeness: 0,
        risks: [{ severity: 'high', description: '评估服务暂时不可用，请稍后点击「重新评估」重试', fixTitle: '重试', fixDescription: '', fixContent: '' }],
        recommendations: [],
        suggestions: [],
        tasks: [],
      };
    }

    // 保存分析，供 acceptRiskFix 读取
    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: { deliveryAnalysis: analysis } as any },
    });

    // 质量门禁
    const quality = await this.qualityGate.runAllChecks(projectId, project.demoHtml || '');

    return { analysis, quality };
  }

  /** 终稿生产交付 — 异步执行 */
  async productionDeliver(userId: string, projectId: string, payload: {
    projectName?: string; planSummary?: any; demoHtml?: string;
  }) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, demoHtml: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    if (!project.demoHtml) throw new BadRequestException('请先生成 Demo 预览');

    const deliveryId = `${projectId.substring(0, 8)}-${Date.now()}`;
    this.logger.log(`[生产交付] 异步启动: ${deliveryId}`);

    // 异步执行全栈生成
    this.runProductionDelivery(deliveryId, projectId, payload).catch(e =>
      this.logger.error(`生产交付异常: ${e}`));

    return { success: true, deliveryId, message: '生产交付已启动' };
  }

  private async runProductionDelivery(deliveryId: string, projectId: string, payload: any) {
    try {
      // Cloudecode 全栈生成
      const result = await this.cloudecodeClient.deliverFullstack(projectId, {
        projectName: payload.projectName || 'app',
        planSummary: payload.planSummary,
        demoHtml: payload.demoHtml,
      });
      this.logger.log(`全栈生成完成: ${result.files?.length || 0} 个文件`);

      // 自动部署
      let productionUrl = '';
      try {
        const dr = await this.deploymentService.deploy(projectId);
        productionUrl = dr.productionUrl;
      } catch (e) {
        this.logger.warn(`部署失败: ${e}`);
      }

      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'completed', productionUrl: productionUrl || `http://localhost:3002/api/deploy/${projectId}` },
      });
    } catch (e) {
      this.logger.error(`全栈生成失败: ${e}`);
    }
  }

  /** 加入修复队列 — 不立即执行，等重新评估时批量处理 */
  async acceptRiskFix(userId: string, projectId: string, riskIndex: number, customFix?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, structuredRequirement: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const analysis = (project.structuredRequirement as any)?.deliveryAnalysis;
    const risks = analysis?.risks || [];
    const risk = risks[riskIndex];
    if (!risk) throw new NotFoundException('风险项不存在');

    const fixContent = customFix || risk.fixContent || risk.description;

    // 存入队列
    const sr = (project.structuredRequirement as any) || {};
    const queue = sr.fixQueue || [];
    queue.push({ riskIndex, fixContent, fixTitle: risk.fixTitle });
    sr.fixQueue = queue;
    sr.deliveryAnalysis = analysis;

    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: sr as any },
    });

    return { success: true, queued: queue.length, message: `已加入修复队列(${queue.length}项)` };
  }

  /** 异步批量执行修复 + 重新评估 */
  async reEvaluate(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, structuredRequirement: true, demoHtml: true, planSummary: true, description: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const sr = (project.structuredRequirement as any) || {};
    const queue = sr.fixQueue || [];

    // 立即返回，异步执行修复
    const taskId = `${projectId.substring(0,8)}-re-${Date.now()}`;
    this.runReEvaluate(taskId, projectId, sr, queue, project.demoHtml ?? '', project.planSummary, project.description).catch(e =>
      this.logger.error(`re Evaluate failed: ${e}`));

    return { success: true, taskId, queuedCount: queue.length, message: `已启动 ${queue.length} 项修复，完成后请重新评估` };
  }

  /** 查询修复状态 */
  async getReEvaluateStatus(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { structuredRequirement: true },
    });
    const sr = (project?.structuredRequirement as any) || {};
    const lastResult = sr.lastReEvaluate;
    const queue = sr.fixQueue || [];
    const analysis = sr.deliveryAnalysis;
    return {
      done: !!(lastResult?.completedAt),
      queuedCount: queue.length,
      fixResults: lastResult?.results || [],
      completeness: analysis?.completeness ?? 0,
      riskCount: analysis?.risks?.length ?? 0,
    };
  }

  private async runReEvaluate(taskId: string, projectId: string, sr: any, queue: any[], demoHtml: string, planSummary: any, description: string | null) {
    const results: string[] = [];

    if (queue.length > 0) {
      this.logger.log(`异步批量执行 ${queue.length} 项修复: ${projectId}`);
      const fixesText = queue.map((item, i) =>
        `${i+1}. ${item.fixTitle}\n   ${item.fixContent}`
      ).join('\n\n');

      let succeeded = false;

      for (let attempt = 0; attempt < 3 && !succeeded; attempt++) {
        if (attempt > 0) {
          this.logger.warn(`批量修复重试 ${attempt + 1}/3`);
          await new Promise(r => setTimeout(r, 3000));
        }
        try {
          const project = await this.prisma.project.findUnique({
            where: { id: projectId }, select: { demoHtml: true },
          });
          const currentHtml = project?.demoHtml ?? '';

          const prompt = `修改以下HTML：\n\n${fixesText}\n\n输出完整HTML，不要省略。\n\n原始HTML：\n${currentHtml.slice(0, 25000)}`;
          const response = await this.deepseek.chat(
            [{ role: 'user', content: prompt }],
            { temperature: 0.3, maxTokens: 16384 },
          );

          const m = response.match(/```html\s*([\s\S]*?)```/) || response.match(/<!DOCTYPE[\s\S]*?<\/html>/i);
          const newHtml = m ? (m[1] || m[0]).replace(/```html\s*/, '').replace(/```$/, '').trim() : '';

          if (newHtml && newHtml.includes('<!DOCTYPE')) {
            await this.prisma.project.update({
              where: { id: projectId }, data: { demoHtml: newHtml, status: 'demo_ready' },
            });
            results.push(`✅ 已完成 ${queue.length} 项修复`);
            succeeded = true;
          }
        } catch (e) {
          this.logger.warn(`批量修复失败 (attempt ${attempt + 1}): ${e}`);
        }
      }

      if (!succeeded) {
        results.push(`❌ 修复失败(重试3次)，请稍后重试`);
        return; // 不退队列，保持原样
      }

      sr.fixQueue = [];
    }

    // 重新评估：读取最新的 Demo HTML
    const latestProject = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true },
    });
    const latestDemoHtml = latestProject?.demoHtml ?? demoHtml;

    const analysis = await this.hermes.analyzeSilent(projectId, latestDemoHtml, planSummary, description);
    const quality = await this.qualityGate.runAllChecks(projectId, latestDemoHtml);

    sr.deliveryAnalysis = analysis;
    sr.lastReEvaluate = { taskId, results, completedAt: new Date().toISOString() };
    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: sr as any },
    });

    this.logger.log(`re Evaluate完成: ${analysis.completeness}%, ${results.length} 项修复`);
  }

  /** 导入 AI 建议 — 一键将建议转为可执行的批注修改任务 */
  async acceptSuggestion(userId: string, projectId: string, suggestionId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, structuredRequirement: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    // 从 structuredRequirement.deliveryAnalysis.suggestions 找到该建议
    const analysis = (project.structuredRequirement as any)?.deliveryAnalysis;
    const suggestions = analysis?.suggestions || [];
    const suggestion = suggestions.find((s: any) => s.id === suggestionId);
    if (!suggestion) throw new NotFoundException('建议不存在');

    // 创建反馈任务 — 走现有的 feedback → pipeline 闭环
    const feedback = await this.prisma.feedbackItem.create({
      data: {
        projectId,
        comment: `[AI建议] ${suggestion.title}: ${suggestion.content}`,
        moduleKey: suggestion.moduleKey || null,
        status: 'new',
      },
    });

    // 触发 Hermes 处理反馈
    this.hermes.handleFeedback(feedback.id).then(taskIds => {
      this.logger.log(`[导入] 建议 ${suggestionId} → ${taskIds.length} 个任务创建`);
    }).catch(err => {
      this.logger.error(`[导入] 建议 ${suggestionId} 处理失败: ${err.message}`);
    });

    return { success: true, feedbackId: feedback.id, message: `已导入"${suggestion.title}"，正在生成修改方案` };
  }

  private async checkN8nAvailability(): Promise<boolean> {
    try {
      const url = process.env.N8N_URL || 'http://localhost:5678';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${url}/healthz`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok;
    } catch {
      this.logger.warn('[状态观测] N8N 健康检查失败，标记为不可用');
      return false;
    }
  }
}
