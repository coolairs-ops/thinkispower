import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { OpenClawClient } from '../../integrations/openclaw/openclaw.client';
import { N8nClient } from '../../integrations/n8n/n8n.client';
import { EVENTS, DeliveryExportRequestedPayload, ExportType, TasksCreatedPayload, TasksCompletedPayload } from '../../events/event-types';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private eventEmitter: EventEmitter2,
    private buildService: BuildService,
    private statusMapper: StatusMapperService,
    private openclaw: OpenClawClient,
    private n8n: N8nClient,
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

    // 读取 OpenClaw 交付分析结果（如果有）
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
            createdAt: latestBuild.createdAt,
          }
        : null,
    };
  }

  /**
   * 确认交付 — 工程控制论的"控制器启动器"。
   *
   * 不再直接 status = 'completed'，而是触发完整控制回路：
   *   1. OpenClaw 认知分析（传感器）→ 任务分解 + 风险评估
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

    // ─── 阶段 1：传感器 — OpenClaw 认知分析 ───
    this.logger.log(`[传感器] OpenClaw 分析项目交付就绪状态`);
    const { taskIds, analysis } = await this.openclaw.handleDeliveryExport(projectId);

    this.logger.log(
      `[传感器] 分析完成: 完整度 ${analysis.completeness}%, ${taskIds.length} 个任务, ${analysis.risks.length} 个风险`,
    );

    // ─── 阶段 2：状态转换 — 标记为交付中 ───
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'exporting',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('exporting'),
      },
    });

    // ─── 阶段 3：创建 Build 记录 ───
    const build = await this.buildService.createBuild(projectId, 'delivery');

    // ─── 阶段 4：控制器调度 — 触发交付编排 ───
    // 判断 N8N 是否可用
    const n8nAvailable = await this.checkN8nAvailability();

    if (n8nAvailable && taskIds.length > 0) {
      // 主路径：N8N 控制器编排
      this.logger.log(`[控制器] N8N 可用，触发交付编排工作流`);
      const result = await this.n8n.triggerDeliveryExportWorkflow(projectId, 'full');

      if (result.success) {
        this.logger.log(`[前向通道] N8N 交付工作流已触发: runId=${result.runId}`);
      } else {
        // N8N 触发失败，降级到 PipelineService
        this.logger.warn(`[降级] N8N 触发失败，降级到 PipelineService 本地执行`);
        const tasksPayload: TasksCreatedPayload = { projectId, feedbackId: null as any, taskIds };
        this.eventEmitter.emit(EVENTS.TASKS_CREATED, tasksPayload);
      }
    } else if (taskIds.length > 0) {
      // 降级路径：PipelineService 本地顺序执行
      this.logger.log(`[降级] N8N 不可用，使用 PipelineService 本地执行`);
      const tasksPayload: TasksCreatedPayload = { projectId, feedbackId: null as any, taskIds };
      this.eventEmitter.emit(EVENTS.TASKS_CREATED, tasksPayload);
    } else {
      // 没有任务需要执行，直接标记为完成
      this.logger.log(`[完成] 无交付任务，直接标记完成`);
      const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3001');
      const productionUrl = `${baseUrl}/api/projects/${projectId}/demo`;
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'completed',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('completed'),
          productionUrl,
        },
      });
    }

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
      select: { id: true, userId: true, user: { select: { plan: true } } },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    // 免费用户限制
    if (project.user.plan === 'free') {
      return { upgradeRequired: true, message: '高级交付服务需升级套餐' };
    }

    // 1. 创建 Build 记录
    const build = await this.buildService.createBuild(projectId, exportType);

    // 2. 更新项目状态为 exporting
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
      const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3001');
      const productionUrl = `${baseUrl}/api/projects/${projectId}/demo`;

      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'completed',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('completed'),
          productionUrl,
        },
      });

      // 更新最新 Build 记录
      const latestBuild = await this.prisma.build.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      if (latestBuild) {
        await this.prisma.build.update({
          where: { id: latestBuild.id },
          data: { status: 'success', productionUrl },
        });
      }

      this.logger.log(`[交付完成] 项目 ${projectId} 交付完成, productionUrl=${productionUrl}`);
    }
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
