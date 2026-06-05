import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IDeploymentProvider, DeploymentResult } from '../interfaces/deployment-provider.interface';
import { MinioService } from '../../../integrations/minio/minio.service';

@Injectable()
export class InternalDeploymentProvider implements IDeploymentProvider {
  private readonly logger = new Logger(InternalDeploymentProvider.name);

  constructor(
    private config: ConfigService,
    private minio?: MinioService,
  ) {}

  getType(): string {
    return 'internal';
  }

  async deploy(projectId: string, html: string, buildId?: string): Promise<DeploymentResult> {
    this.logger.log(`Internal deploy: project=${projectId} build=${buildId}`);

    const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3001');
    const url = `${baseUrl}/api/deploy/${projectId}`;

    let externalUrl: string | undefined;
    let uploadSuccess = false;
    if (this.minio) {
      try {
        const objectName = `deployments/${projectId}/index.html`;
        externalUrl = await this.minio.uploadFile(objectName, Buffer.from(html, 'utf-8'), {
          contentType: 'text/html; charset=utf-8',
        });
        uploadSuccess = true;
        this.logger.log(`Deployment uploaded to MinIO: ${objectName}`);
      } catch (error) {
        this.logger.warn(`MinIO upload failed for deployment, serving via API: ${error}`);
      }
    } else {
      this.logger.warn('MinIO not configured — HTML served via API proxy, not persisted to object storage');
    }

    return {
      success: true, // API proxy always works since HTML is in DB
      url: externalUrl || url,
      provider: 'internal',
      errorMessage: uploadSuccess ? undefined : 'Deployed via API proxy (MinIO unavailable)',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}
