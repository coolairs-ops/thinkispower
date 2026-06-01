import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private buildService: BuildService,
  ) {}

  async getDelivery(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { deliveryOptions: true, user: { select: { plan: true } } },
    });

    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const options = project.deliveryOptions;
    const latestBuild = await this.buildService.getLatestBuild(projectId);
    const deliveryAnalysis = (project.structuredRequirement as any)?.deliveryAnalysis || null;

    return {
      productionUrl: project.productionUrl,
      status: project.status,
      publicStatusLabel: project.publicStatusLabel,
      isPro: project.user.plan === 'pro' || project.user.plan === 'enterprise',
      deliveryAnalysis,
      latestBuild: latestBuild
        ? {
            id: latestBuild.id, version: latestBuild.version, status: latestBuild.status,
            sourceZipUrl: latestBuild.sourceZipUrl, productionUrl: latestBuild.productionUrl,
            createdAt: latestBuild.createdAt,
          }
        : null,
    };
  }

  static async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时 (${ms}ms)`)), ms);
    });
    try {
      const result = await Promise.race([promise, timeout]);
      clearTimeout(timer!);
      return result;
    } catch (e) {
      clearTimeout(timer!);
      throw e;
    }
  }
}
