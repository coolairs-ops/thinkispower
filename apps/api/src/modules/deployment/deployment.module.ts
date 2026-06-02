import { Module } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { DeployController } from './deploy.controller';
import { DeployPipelineService } from '../../services/deploy-pipeline.service';
import { InternalDeploymentProvider } from './providers/internal-deployment.provider';
import { DEPLOYMENT_PROVIDERS } from './interfaces/deployment-provider.interface';
import { MinioModule } from '../../integrations/minio/minio.module';

@Module({
  imports: [MinioModule],
  controllers: [DeployController],
  providers: [
    DeploymentService,
    DeployPipelineService,
    InternalDeploymentProvider,
    {
      provide: DEPLOYMENT_PROVIDERS,
      useFactory: (internal: InternalDeploymentProvider) => [internal],
      inject: [InternalDeploymentProvider],
    },
  ],
  exports: [DeploymentService, DeployPipelineService],
})
export class DeploymentModule {}
