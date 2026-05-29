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

    // Upload to MinIO as a permanent deployment artifact if available
    let externalUrl: string | undefined;
    if (this.minio) {
      try {
        const objectName = `deployments/${projectId}/index.html`;
        externalUrl = await this.minio.uploadFile(objectName, Buffer.from(html, 'utf-8'), {
          contentType: 'text/html; charset=utf-8',
        });
        this.logger.log(`Deployment uploaded to MinIO: ${objectName}`);
      } catch (error) {
        this.logger.warn(`MinIO upload failed for deployment, serving via API: ${error}`);
      }
    }

    return {
      success: true,
      url,
      provider: 'internal',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}
