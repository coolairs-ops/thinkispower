import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../database/prisma.service';
import { BuildService } from './build.service';
import { StatusMapperService } from './status-mapper.service';
import {
  EVENTS,
  DeliveryExportRequestedPayload,
  DeliveryExportCompletedPayload,
  DeliveryExportFailedPayload,
  ExportType,
} from '../events/event-types';

/**
 * 交付导出编排器。
 *
 * 监听 DELIVERY_EXPORT_REQUESTED 事件，按 exportType 路由到对应执行器。
 *
 * ── 集成点（存根，需同事实现） ──
 * source / deployment → Cloudecode ICodeGenerator / IDeploymentConfigGenerator
 * package             → OpenClaw handleDeliveryExport()
 * repository / database → N8N triggerDeliveryExportWorkflow()
 */
@Injectable()
export class DeliveryOrchestrator {
  private readonly logger = new Logger(DeliveryOrchestrator.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private prisma: PrismaService,
    private buildService: BuildService,
    private statusMapper: StatusMapperService,
  ) {}

  @OnEvent(EVENTS.DELIVERY_EXPORT_REQUESTED)
  async handleExportRequest(payload: DeliveryExportRequestedPayload): Promise<void> {
    const { projectId, buildId, exportType } = payload;
    this.logger.log(`Delivery export requested: ${exportType} for project ${projectId}`);

    try {
      // 1. 更新 Build 状态为 building
      await this.buildService.updateBuildStatus(buildId, 'building');

      // 2. 根据 exportType 路由到对应执行器
      let artifactUrl: string | undefined;

      switch (exportType) {
        case 'source':
        case 'deployment':
          artifactUrl = await this.handleCodeGeneration(payload);
          break;

        case 'package':
          artifactUrl = await this.handlePackageExport(payload);
          break;

        case 'repository':
        case 'database':
          artifactUrl = await this.handleN8nWorkflow(payload);
          break;

        default:
          throw new Error(`Unknown export type: ${exportType}`);
      }

      // 3. 更新 Build artifact
      if (artifactUrl) {
        await this.buildService.updateBuildArtifact(buildId, exportType, artifactUrl);
      }

      // 4. 更新 Build 状态 + 项目状态
      await this.buildService.updateBuildStatus(buildId, 'success');
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'demo_ready',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_ready'),
        },
      });

      // 5. 发出完成事件
      const completedPayload: DeliveryExportCompletedPayload = { projectId, buildId, exportType, artifactUrl };
      this.eventEmitter.emit(EVENTS.DELIVERY_EXPORT_COMPLETED, completedPayload);

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Delivery export failed for ${exportType} (build ${buildId}): ${msg}`);

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

  // ────────── 集成点：代码生成（Cloudecode）──────────
  /**
   * 集成点: Cloudecode 代码生成。
   *
   * 【存根】同事需：
   * 1. 在 cloudecode.client.ts 中实现 ICodeGenerator / IDeploymentConfigGenerator
   * 2. 在这里注入并调用
   *
   * 当前返回模拟 URL 以便端到端流程可验证。
   */
  private async handleCodeGeneration(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, exportType } = payload;

    // TODO: 注入 ICodeGenerator / IDeploymentConfigGenerator 并调用
    // const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { planSummary: true, demoHtml: true, moduleMap: true } });
    // const result = await this.codeGenerator.generateSource({ projectId, planSummary: project.planSummary, demoHtml: project.demoHtml, moduleMap: project.moduleMap });
    // return result.sourceZipUrl;

    this.logger.log(`[STUB] Code generation for ${exportType} — implement ICodeGenerator to make this real`);
    return undefined;
  }

  // ────────── 集成点：OpenClaw ──────────
  /**
   * 集成点: OpenClaw 复杂任务分解。
   *
   * 【存根】同事需：
   * 1. 在 openclaw.client.ts 中添加 handleDeliveryExport() 方法
   * 2. 创建 Task 记录，type = export_package
   * 3. 发出 TASKS_CREATED 事件让 PipelineService 处理
   */
  private async handlePackageExport(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId } = payload;

    // TODO: 调用 OpenClaw 拆解打包任务
    // const taskIds = await this.openclaw.handleDeliveryExport(projectId, 'package');
    // this.eventEmitter.emit(EVENTS.TASKS_CREATED, { projectId, feedbackId: null, taskIds });

    this.logger.log(`[STUB] Package export for ${projectId} — implement OpenClaw handleDeliveryExport() to make this real`);
    return undefined;
  }

  // ────────── 集成点：N8N ──────────
  /**
   * 集成点: N8N 异步工作流。
   *
   * 【存根】同事需：
   * 1. 取消注释 n8n.client.ts 中的 fetch 调用
   * 2. 配置 N8N webhook URL
   * 3. 工作流完成后回调 /api/webhooks/delivery-complete 更新 Build
   */
  private async handleN8nWorkflow(payload: DeliveryExportRequestedPayload): Promise<string | undefined> {
    const { projectId, exportType, buildId } = payload;

    // TODO: 调用 N8nClient.triggerDeliveryExportWorkflow()
    // await this.n8n.triggerDeliveryExportWorkflow(projectId, exportType, { buildId });

    this.logger.log(`[STUB] N8N workflow for ${exportType} (project ${projectId}) — implement triggerDeliveryExportWorkflow() to make this real`);
    return undefined;
  }
}
