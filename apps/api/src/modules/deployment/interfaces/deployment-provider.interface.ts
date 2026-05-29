export interface DeploymentResult {
  success: boolean;
  url?: string;
  errorMessage?: string;
  provider: string;
}

export interface IDeploymentProvider {
  getType(): string;
  deploy(projectId: string, html: string, buildId?: string): Promise<DeploymentResult>;
  isAvailable(): boolean;
}

export const DEPLOYMENT_PROVIDERS = 'DEPLOYMENT_PROVIDERS';
