import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../database/prisma.service';
import { BuildService } from './build.service';
import { StatusMapperService } from './status-mapper.service';
import { DeepseekService } from './deepseek.service';
import { HermesClient } from '../integrations/hermes/hermes.client';
import { N8nClient } from '../integrations/n8n/n8n.client';
import { MinioService } from '../integrations/minio/minio.service';
import {
  EVENTS,
  DeliveryExportRequestedPayload,
  DeliveryExportCompletedPayload,
  DeliveryExportFailedPayload,
  ExportType,
} from '../events/event-types';

/**
 * 执行器接口 — 每个执行器都是一个"被控对象"的驱动。
 * 可替换、可测试，为未来的自适应控制律提供基础。
 */
export interface ICodeGenerator {
  generate(buildId: string, projectId: string): Promise<{ success: boolean; artifactUrl?: string }>;
}

export interface IPackageExporter {
  export(buildId: string, projectId: string): Promise<{ success: boolean; artifactUrl?: string }>;
}

export interface IN8nWorkflowDriver {
  run(projectId: string, exportType: string): Promise<{ success: boolean; runId?: string }>;
}

/**
 * 交付导出编排器 — 工程控制论的"控制器"环节。
 *
 * 监听 DELIVERY_EXPORT_REQUESTED 事件，按 exportType 路由到对应执行器，
 * 每个执行器完成后通过反馈回路（事件）上报状态。
 *
 * ── 工程控制论映射 ──
 * 控制器（Controller）    → DeliveryOrchestrator.handleExportRequest()
 * 被控对象（Plant）       → 三个执行器（CodeGen / PackageExport / N8nWorkflow）
 * 反馈信道（Feedback）    → DELIVERY_EXPORT_COMPLETED / DELIVERY_EXPORT_FAILED 事件
 * 状态观测器（Observer）  → Build 状态 + project.status
 */
@Injectable()
export class DeliveryOrchestrator {
  private readonly logger = new Logger(DeliveryOrchestrator.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private prisma: PrismaService,
    private buildService: BuildService,
    private statusMapper: StatusMapperService,
    private deepseek: DeepseekService,
    private hermes: HermesClient,
    private n8n: N8nClient,
    private minio: MinioService,
  ) {}

  @OnEvent(EVENTS.DELIVERY_EXPORT_REQUESTED)
  async handleExportRequest(payload: DeliveryExportRequestedPayload): Promise<void> {
    const { projectId, buildId, exportType } = payload;
    this.logger.log(`[控制器] 交付导出请求: ${exportType} 项目 ${projectId} 构建 ${buildId}`);

    try {
      // 1. 更新 Build 状态为 building
      await this.buildService.updateBuildStatus(buildId, 'building');

      // 2. 异步导出类型（N8N 工作流）— 触发后不等结果，由 webhook 回调完成
      if (exportType === 'repository' || exportType === 'database') {
        await this.handleN8nWorkflow(payload);
        // 对于异步类型，不在此处标记完成；webhook 回调会处理
        return;
      }

      // 3. 同步导出类型 — 等待执行结果
      let artifactUrl: string | undefined;

      switch (exportType) {
        case 'source':
        case 'deployment':
          artifactUrl = await this.handleCodeGeneration(payload);
          break;

        case 'package':
          artifactUrl = await this.handlePackageExport(payload);
          break;

        default:
          throw new Error(`Unknown export type: ${exportType}`);
      }

      // 4. 更新 Build artifact
      if (artifactUrl) {
        await this.buildService.updateBuildArtifact(buildId, exportType, artifactUrl);
      }

      // 5. 更新 Build 状态 + 项目状态
      await this.buildService.updateBuildStatus(buildId, 'success');
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'demo_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_ready'),
        },
      });

      // 6. 发出完成事件 — 正向通道完成
      const completedPayload: DeliveryExportCompletedPayload = { projectId, buildId, exportType, artifactUrl };
      this.eventEmitter.emit(EVENTS.DELIVERY_EXPORT_COMPLETED, completedPayload);
      this.logger.log(`[反馈] 交付导出完成: ${exportType} project=${projectId}`);

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[异常] 交付导出失败 ${exportType} (build ${buildId}): ${msg}`);

      // 误差修正：更新为失败状态
      await this.buildService.updateBuildStatus(buildId, 'failed');
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'build_failed',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('build_failed'),
        },
      });

      const failedPayload: DeliveryExportFailedPayload = { projectId, buildId, exportType, error: msg };
      this.eventEmitter.emit(EVENTS.DELIVERY_EXPORT_FAILED, failedPayload);
    }
  }

  // ═══════════ 执行机构 1：代码生成（Cloudecode + DeepSeek）═══════════
  /**
   * 工程控制论 — 被控对象驱动。
   * 输入：project + demoHtml
   * 输出：优化后的生产级 HTML → MinIO → artifactUrl
   * 反馈：DELIVERY_EXPORT_COMPLETED 事件
   */
  private async handleCodeGeneration(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, buildId, exportType } = payload;
    this.logger.log(`[执行机构] 代码生成: ${exportType} 项目 ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, planSummary: true },
    });

    if (!project?.demoHtml) {
      this.logger.warn(`[执行机构] 项目 ${projectId} 无 Demo HTML，跳过代码生成`);
      return undefined;
    }

    // 调用 DeepSeek 做最终优化 — 控制律：temperature=0.3 保证确定性输出
    const optimizationPrompt = `你是一个前端工程师，负责将项目的 Demo HTML 优化为生产可用的最终版本。要求：
1. 清理所有 debug 代码、console.log、TODO 注释
2. 确保所有交互功能（按钮点击、表单提交、路由切换等）正常工作
3. 优化样式，确保在所有屏幕尺寸下显示良好（响应式）
4. 添加适当的加载状态和错误处理
5. 保持原有的所有功能不变
6. 直接返回完整的优化后的 HTML，不要用 markdown 包裹`;

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: optimizationPrompt },
        { role: 'user', content: `请优化以下 Demo HTML：\n\n${project.demoHtml}` },
      ],
      { temperature: 0.3, maxTokens: 8192 },
    );

    const optimizedHtml = this.extractHtml(response) || response;
    const buffer = Buffer.from(optimizedHtml, 'utf-8');

    // 上传到 MinIO 并记录 artifactUrl
    const url = await this.buildService.uploadArtifact(buildId, projectId, exportType, buffer, 'index.html', 'text/html');

    // 同时更新项目的 demoHtml 为优化版本
    await this.prisma.project.update({
      where: { id: projectId },
      data: { demoHtml: optimizedHtml },
    });

    this.logger.log(`[执行机构] 代码生成完成: ${url || '无 MinIO'}`);
    return url;
  }

  // ═══════════ 执行机构 2：打包导出 ═══════════
  /**
   * 将 Demo HTML 打包为可下载的文件。
   * 简单场景：直接上传 HTML；复杂场景：调用 Hermes 分解为子任务。
   */
  private async handlePackageExport(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, buildId } = payload;
    this.logger.log(`[执行机构] 打包导出: 项目 ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, name: true },
    });

    if (!project?.demoHtml) {
      this.logger.warn(`[执行机构] 项目 ${projectId} 无 Demo HTML，跳过打包`);
      return undefined;
    }

    // 简打包：将 HTML 上传到 MinIO
    const buffer = Buffer.from(project.demoHtml, 'utf-8');
    const url = await this.buildService.uploadArtifact(buildId, projectId, 'package', buffer, `${project.name || 'project'}.html`, 'text/html');

    this.logger.log(`[执行机构] 打包导出完成: ${url || '无 MinIO'}`);
    return url;
  }

  // ═══════════ 执行机构 3：N8N 工作流（异步 + 反馈闭环）═══════════
  /**
   * 工程控制论 — 前向通道触发 + 反馈信道等待。
   *
   * 调用 N8N 工作流（delivery-export），由 N8N 编排详细的交付任务。
   * N8N 通过以下回调完成反馈闭环：
   *   1. POST /api/n8n-webhook/execute-task → Cloudecode 执行单个任务
   *   2. POST /api/n8n-webhook/task-complete → 更新单个任务状态
   *   3. POST /api/n8n-webhook/delivery-complete → 全部完成，更新状态
   *
   * 注意：此方法不在此处标记 Build 完成，由 delivery-complete 回调处理。
   */
  private async handleN8nWorkflow(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, exportType, buildId } = payload;
    this.logger.log(`[执行机构] N8N 工作流: ${exportType} 项目 ${projectId}`);

    const result = await this.n8n.triggerDeliveryExportWorkflow(projectId, exportType);

    if (!result.success) {
      throw new Error(`N8N 工作流触发失败: ${exportType}`);
    }

    this.logger.log(`[前向通道] N8N 工作流已触发: runId=${result.runId} build=${buildId}`);
    // 异步执行，结果由 webhook 回调反馈 — 不在此处返回 artifactUrl
    return undefined;
  }

  // ═══════════ 工具方法 ═══════════
  private extractHtml(response: string): string | null {
    // Try markdown code block first
    const htmlBlock = response.match(/```html\s*([\s\S]*?)```/);
    if (htmlBlock) return htmlBlock[1].trim();

    // Try any code block
    const codeBlock = response.match(/```\s*([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1].trim();

    // If response looks like HTML, use it directly
    if (response.trim().startsWith('<')) return response.trim();

    return null;
  }
}
