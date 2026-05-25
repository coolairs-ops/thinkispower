import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { EVENTS, DeliveryExportRequestedPayload, ExportType } from '../../events/event-types';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private buildService: BuildService,
    private statusMapper: StatusMapperService,
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

    return {
      productionUrl: project.productionUrl,
      adminEmail: null,
      isPro: project.user.plan === 'pro' || project.user.plan === 'enterprise',
      onlineUrlEnabled: options?.onlineUrlEnabled ?? true,
      sourceZipEnabled: options?.sourceZipEnabled ?? false,
      packageExportEnabled: options?.packageExportEnabled ?? false,
      gitRepositoryEnabled: options?.gitRepositoryEnabled ?? false,
      databaseExportEnabled: options?.databaseExportEnabled ?? false,
      deploymentConfigEnabled: options?.deploymentConfigEnabled ?? false,
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
            createdAt: latestBuild.createdAt,
          }
        : null,
    };
  }

  async confirmDelivery(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, status: true },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'completed',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('completed'),
      },
    });

    return { success: true };
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
}
