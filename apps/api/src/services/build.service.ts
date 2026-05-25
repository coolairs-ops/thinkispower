import { Injectable, Optional, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MinioService } from '../integrations/minio/minio.service';

const EXPORT_TYPE_FIELD_MAP: Record<string, string> = {
  source: 'sourceZipUrl',
  package: 'packageZipUrl',
  repository: 'repositoryUrl',
  database: 'databaseSchemaUrl',
  deployment: 'deploymentConfigUrl',
};

@Injectable()
export class BuildService {
  private readonly logger = new Logger(BuildService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private minio?: MinioService,
  ) {}

  /**
   * 创建 Build 记录，version 按项目自动递增。
   */
  async createBuild(projectId: string, exportType: string) {
    const last = await this.prisma.build.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const build = await this.prisma.build.create({
      data: {
        projectId,
        version: (last?.version ?? 0) + 1,
        status: 'created',
      },
    });

    this.logger.log(`Build v${build.version} created for project ${projectId} (${exportType})`);
    return build;
  }

  /**
   * 更新 Build 的 artifact URL（根据 exportType 映射到对应字段）。
   */
  async updateBuildArtifact(buildId: string, exportType: string, url: string): Promise<void> {
    const field = EXPORT_TYPE_FIELD_MAP[exportType];
    if (!field) {
      this.logger.warn(`Unknown export type "${exportType}" for build artifact`);
      return;
    }

    await this.prisma.build.update({
      where: { id: buildId },
      data: { [field]: url },
    });

    this.logger.log(`Build ${buildId} artifact updated: ${field} = ${url}`);
  }

  /**
   * 更新 Build 状态: created → building → success | failed
   */
  async updateBuildStatus(buildId: string, status: string): Promise<void> {
    await this.prisma.build.update({
      where: { id: buildId },
      data: { status },
    });
    this.logger.log(`Build ${buildId} status -> ${status}`);
  }

  /**
   * Upload an artifact buffer to MinIO and store the URL in the Build record.
   * Falls back silently if MinioService is not configured.
   */
  async uploadArtifact(
    buildId: string,
    projectId: string,
    exportType: string,
    buffer: Buffer,
    filename: string,
    contentType?: string,
  ): Promise<string | undefined> {
    if (!this.minio) {
      this.logger.warn('MinIO not configured — cannot upload artifact');
      return undefined;
    }

    try {
      const objectName = this.minio.buildObjectName(projectId, exportType, filename);
      const url = await this.minio.uploadFile(objectName, buffer, {
        contentType: contentType || 'application/octet-stream',
      });

      await this.updateBuildArtifact(buildId, exportType, url);
      this.logger.log(`Artifact uploaded for build ${buildId}: ${objectName}`);
      return url;
    } catch (error) {
      this.logger.error(`Failed to upload artifact for build ${buildId}: ${error}`);
      return undefined;
    }
  }

  /**
   * 获取项目最新 Build。
   */
  async getLatestBuild(projectId: string) {
    return this.prisma.build.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * 获取项目 Build 列表（不含 payload 字段）。
   */
  async findByProject(projectId: string) {
    return this.prisma.build.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        sourceZipUrl: true,
        packageZipUrl: true,
        repositoryUrl: true,
        databaseSchemaUrl: true,
        deploymentConfigUrl: true,
        demoUrl: true,
        productionUrl: true,
        createdAt: true,
      },
    });
  }
}
