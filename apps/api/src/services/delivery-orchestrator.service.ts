import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../database/prisma.service';
import { BuildService } from './build.service';
import { StatusMapperService } from './status-mapper.service';
import { DeepseekService } from './deepseek.service';
import { CloudecodeClient } from '../integrations/cloudecode/cloudecode.client';
import { HermesClient } from '../integrations/hermes/hermes.client';
import { N8nClient } from '../integrations/n8n/n8n.client';
import { MinioService } from '../integrations/minio/minio.service';
import { createZipBuffer } from '../common/utils/zip';
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
    private cloudecode: CloudecodeClient,
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

      let artifactUrl: string | undefined;

      // 2. 异步导出类型（N8N 工作流）— 触发后不等结果，由 webhook 回调完成
      if (exportType === 'repository' || exportType === 'database') {
        artifactUrl = await this.handleN8nWorkflow(payload);
        if (artifactUrl === undefined) return; // N8N 异步路径：webhook 回调处理完成
        // 降级路径：本地生成完成，跳过 switch，流入完成逻辑
      } else {
        // 3. 同步导出类型 — 等待执行结果
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

  // ═══════════ 执行机构 1：真实项目代码生成（不再是仅优化 HTML）═══════════
  /**
   * 使用 CloudecodeClient.generateProject() 生成完整项目结构：
   * index.html + package.json + Dockerfile + nginx.conf + README + .gitignore + 测试
   * 打包为 zip 上传到 MinIO。
   */
  private async handleCodeGeneration(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, buildId, exportType } = payload;
    this.logger.log(`[执行机构] 源码生成: ${exportType} 项目 ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, planSummary: true, name: true, structuredRequirement: true },
    });

    if (!project?.demoHtml) {
      this.logger.warn(`[执行机构] 项目 ${projectId} 无 Demo HTML，跳过代码生成`);
      return undefined;
    }

    // 1. 生成完整的多文件项目
    const files = await this.cloudecode.generateProject({
      name: project.name || undefined,
      demoHtml: project.demoHtml,
      planSummary: project.planSummary,
      structuredRequirement: project.structuredRequirement,
    });

    // 2. 打包为 zip
    const zipBuffer = await createZipBuffer(project.name || 'project', files);

    // 3. 上传到 MinIO
    const url = await this.buildService.uploadArtifact(
      buildId, projectId, exportType,
      zipBuffer, `${project.name || 'project'}-source.zip`,
      'application/zip',
    );

    this.logger.log(`[执行机构] 源码生成完成: ${url || '无 MinIO'} (${zipBuffer.length} bytes, ${files.length} files)`);
    return url;
  }

  // ═══════════ 执行机构 2：项目包导出（完整项目 zip，而非仅 HTML）═══════════
  private async handlePackageExport(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, buildId } = payload;
    this.logger.log(`[执行机构] 项目包导出: 项目 ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, name: true, planSummary: true, structuredRequirement: true },
    });

    if (!project?.demoHtml) {
      this.logger.warn(`[执行机构] 项目 ${projectId} 无 Demo HTML，跳过打包`);
      return undefined;
    }

    // 生成完整项目结构
    const files = await this.cloudecode.generateProject({
      name: project.name || undefined,
      demoHtml: project.demoHtml,
      planSummary: project.planSummary,
      structuredRequirement: project.structuredRequirement,
    });

    // 打包为 zip
    const zipBuffer = await createZipBuffer(project.name || 'project', files);
    const url = await this.buildService.uploadArtifact(
      buildId, projectId, 'package',
      zipBuffer, `${project.name || 'project'}-package.zip`,
      'application/zip',
    );

    this.logger.log(`[执行机构] 项目包导出完成: ${url || '无 MinIO'} (${zipBuffer.length} bytes)`);
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

    if (result.success) {
      this.logger.log(`[前向通道] N8N 工作流已触发: runId=${result.runId} build=${buildId}`);
      return undefined; // webhook 回调处理完成，不在此处返回 URL
    }

    // 降级路径：N8N 不可用时本地生成资产
    this.logger.warn(`[降级] N8N 不可用，本地生成 ${exportType} 资产`);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, demoHtml: true, planSummary: true, structuredRequirement: true },
    });
    if (!project) throw new Error(`Project ${projectId} not found`);

    const assetTaskType = exportType === 'database' ? 'export_database_schema' : `export_${exportType}`;
    const asset = await this.cloudecode.generateAsset(assetTaskType, {
      planSummary: project.planSummary as string | null,
      structuredRequirement: project.structuredRequirement,
      demoHtml: project.demoHtml,
    });

    const buffer = Buffer.from(asset.content, 'utf-8');
    const url = await this.buildService.uploadArtifact(
      buildId, projectId, exportType,
      buffer, asset.fileName, asset.contentType,
    );

    this.logger.log(`[降级] 本地 ${exportType} 资产生成完成: ${url}`);
    return url;
  }

}
