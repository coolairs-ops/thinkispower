import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';
import * as fs from 'fs';
import * as path from 'path';

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

    // 获取生成文件列表
    const generatedFiles: string[] = [];
    if (latestBuild?.sourceZipUrl) {
      const match = latestBuild.sourceZipUrl.match(/delivery\/([^/]+)$/);
      if (match) {
        const deliveryDir = path.join(process.cwd(), '.hermes', 'deliveries', match[1]);
        if (fs.existsSync(deliveryDir)) {
          this.walkDir(deliveryDir, deliveryDir, generatedFiles);
        }
      }
    }

    return {
      productionUrl: project.productionUrl,
      status: project.status,
      publicStatusLabel: project.publicStatusLabel,
      isPro: project.user.plan === 'pro' || project.user.plan === 'enterprise',
      deliveryAnalysis,
      generatedFiles,
      latestBuild: latestBuild
        ? {
            id: latestBuild.id, version: latestBuild.version, status: latestBuild.status,
            sourceZipUrl: latestBuild.sourceZipUrl, productionUrl: latestBuild.productionUrl,
            createdAt: latestBuild.createdAt,
          }
        : null,
    };
  }

  private walkDir(dir: string, baseDir: string, result: string[]) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      if (entry.isDirectory()) {
        this.walkDir(fullPath, baseDir, result);
      } else {
        result.push(relativePath);
      }
    }
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
