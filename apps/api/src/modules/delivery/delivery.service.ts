import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';
import { assertResourceAccess } from '../../common/utils/tenant-scope';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private buildService: BuildService,
  ) {}

  async getDelivery(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { deliveryOptions: true, user: { select: { plan: true } } },
    });

    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    const options = project.deliveryOptions;
    const latestBuild = await this.buildService.getLatestBuild(projectId);
    const deliveryAnalysis = (project.deliveryAnalysis as any) || null;

    // 若依底座项目：上线产品仍是当前项目业务应用；这里给出业务登录账号，用于应用内数据读写/权限验证。
    const be = project.backendRuntime as { kind?: string; initialUsers?: Array<{ userName: string; password: string; role: string }> } | null;
    const initialUser = be?.kind === 'ruoyi' ? be?.initialUsers?.[0] : undefined;
    const consoleLogin = be?.kind === 'ruoyi'
      ? {
          username: initialUser?.userName ?? null,
          password: initialUser?.password ?? null,
          hasScopedAccount: !!initialUser?.userName,
          note: initialUser?.userName
            ? '请用此应用账号登录交付后的业务系统；它用于本项目的数据权限和操作审计。'
            : '此项目较早置备、暂无应用账号；重新交付即可自动生成业务账号。',
        }
      : null;

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
      consoleLogin,
      status: project.status,
      goLiveStatus: project.goLiveStatus,
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
