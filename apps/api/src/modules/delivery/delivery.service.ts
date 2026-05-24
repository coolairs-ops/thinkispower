import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(private prisma: PrismaService) {}

  async getDelivery(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { deliveryOptions: true, user: { select: { plan: true } } },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const options = project.deliveryOptions;

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
      data: { status: 'completed' },
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

    const upgradeRequired = project.user.plan === 'free';

    if (!upgradeRequired) {
      this.logger.log(`Export requested: ${exportType} for project ${projectId}`);
    }

    return { upgradeRequired, message: upgradeRequired ? '高级交付服务需升级套餐' : '已收到请求，平台正在处理。' };
  }
}
