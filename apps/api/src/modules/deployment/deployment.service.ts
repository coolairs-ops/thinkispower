import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { IDeploymentProvider, DEPLOYMENT_PROVIDERS, DeploymentResult } from './interfaces/deployment-provider.interface';
import { BACKEND_RUNTIME, BackendRuntime } from '../app-runtime/backend-runtime.interface';
import { RuoyiAppDataService } from '../app-runtime/ruoyi-appdata.service';

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @Optional()
    @Inject(DEPLOYMENT_PROVIDERS)
    private providers?: IDeploymentProvider[],
    @Optional()
    @Inject(BACKEND_RUNTIME)
    private backend?: BackendRuntime,
    @Optional()
    private ruoyiAppData?: RuoyiAppDataService,
  ) {}

  async deploy(
    projectId: string,
    buildId?: string,
  ): Promise<{ deploymentId: string; productionUrl: string; backend?: { schemaName: string; resources: string[] } }> {
    this.logger.log(`Deploying project ${projectId} build=${buildId}`);

    // 1. Read current demoHtml + 数据模型
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true, dataModel: true, backendRuntime: true },
    });

    const html = project?.demoHtml;
    if (!html) {
      this.logger.warn(`No demoHtml for project ${projectId} — cannot deploy`);
      const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3001');
      return { deploymentId: '', productionUrl: `${baseUrl}/api/deploy/${projectId}` };
    }

    // 1.5 确保 per-project 后端数据服务就位（幂等）——让在线链接背后真有 API，而非只托管静态 HTML。
    // demo 注入的 appData 走相对路径 /api/app/<projectId>/，与 serveDeploy 同源（均在 API），无需跨域配置。
    let backendInfo: { schemaName: string; resources: string[] } | undefined;
    // 若依底座项目由若依提供数据/权限后端，不该用 crud 置备覆盖 backendRuntime 描述符（保 designate/已置备态）。
    const isRuoyi = (project.backendRuntime as { kind?: string } | null)?.kind === 'ruoyi';
    if (this.backend && project.dataModel && !isRuoyi) {
      try {
        const { descriptor } = await this.backend.provision(projectId, project.dataModel);
        backendInfo = { schemaName: descriptor.schemaName, resources: descriptor.resources };
        this.logger.log(`后端数据服务就位: [${descriptor.resources.join(', ')}]`);
      } catch (e) {
        this.logger.warn(`后端数据服务置备失败（在线应用将无数据接口，降级为纯前端）: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 2. Create Deployment record
    const deployment = await this.prisma.deployment.create({
      data: {
        projectId,
        buildId: buildId || undefined,
        html,
        status: 'deploying',
      },
    });

    // 3. Run through all available providers
    let result: DeploymentResult = { success: false, provider: 'none', errorMessage: 'No provider available' };

    if (this.providers && this.providers.length > 0) {
      for (const provider of this.providers) {
        if (!provider.isAvailable()) continue;
        try {
          result = await provider.deploy(projectId, html, buildId);
          if (result.success) {
            break;
          }
        } catch (error) {
          this.logger.error(`Provider ${provider.getType()} failed: ${error}`);
          result = { success: false, provider: provider.getType(), errorMessage: String(error) };
        }
      }
    }

    // 4. Update deployment record with result
    const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3001');
    const productionUrl = `${baseUrl}/api/deploy/${projectId}`;

    await this.prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: result.success ? 'deployed' : 'failed',
        provider: result.provider,
        externalUrl: result.url || undefined,
        errorMessage: result.errorMessage || undefined,
        deployedAt: result.success ? new Date() : undefined,
      },
    });

    // 5. Update project.productionUrl
    await this.prisma.project.update({
      where: { id: projectId },
      data: { productionUrl },
    });

    // 6. Update build.productionUrl
    if (buildId) {
      await this.prisma.build.update({
        where: { id: buildId },
        data: { productionUrl },
      }).catch((err) => {
        this.logger.warn(`Failed to update build ${buildId} productionUrl: ${err}`);
      });
    }

    this.logger.log(`Deployment complete: project=${projectId} url=${productionUrl} status=${result.success ? 'deployed' : 'failed'}`);

    return { deploymentId: deployment.id, productionUrl, backend: backendInfo };
  }

  async getDeployedHtml(projectId: string): Promise<string | null> {
    const deployment = await this.prisma.deployment.findFirst({
      where: { projectId, status: 'deployed' },
      orderBy: { deployedAt: 'desc' },
      select: { html: true },
    });
    const html = deployment?.html || null;
    if (!html || !this.ruoyiAppData?.enabled) return html;
    // 若项目后端是若依，serve 时把烘焙的路B appData 换成若依版（+服务端 token），令前端显示若依真数据
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { backendRuntime: true, name: true } });
    return (await this.ruoyiAppData.transform(html, project?.backendRuntime, project?.name, projectId)) ?? html;
  }

  async getHistory(projectId: string) {
    return this.prisma.deployment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        provider: true,
        externalUrl: true,
        createdAt: true,
        deployedAt: true,
      },
    });
  }
}
