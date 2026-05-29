import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { IDeploymentProvider, DEPLOYMENT_PROVIDERS, DeploymentResult } from './interfaces/deployment-provider.interface';

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @Optional()
    @Inject(DEPLOYMENT_PROVIDERS)
    private providers?: IDeploymentProvider[],
  ) {}

  async deploy(projectId: string, buildId?: string): Promise<{ deploymentId: string; productionUrl: string }> {
    this.logger.log(`Deploying project ${projectId} build=${buildId}`);

    // 1. Read current demoHtml
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true },
    });

    const html = project?.demoHtml;
    if (!html) {
      this.logger.warn(`No demoHtml for project ${projectId} — cannot deploy`);
      const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3001');
      return { deploymentId: '', productionUrl: `${baseUrl}/api/deploy/${projectId}` };
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

    return { deploymentId: deployment.id, productionUrl };
  }

  async getDeployedHtml(projectId: string): Promise<string | null> {
    const deployment = await this.prisma.deployment.findFirst({
      where: { projectId, status: 'deployed' },
      orderBy: { deployedAt: 'desc' },
      select: { html: true },
    });

    return deployment?.html || null;
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
