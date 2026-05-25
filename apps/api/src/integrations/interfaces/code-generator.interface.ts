/**
 * Cloudecode 交付集成接口。
 *
 * 同事实现 ICodeGenerator 和 IDeploymentConfigGenerator 接口，
 * 在 cloudecode.client.ts 中注入到 DeliveryOrchestrator。
 */

export interface CodeGenInput {
  projectId: string;
  planSummary: Record<string, any>;
  demoHtml: string;
  moduleMap?: Record<string, any>;
}

export interface CodeGenResult {
  success: boolean;
  sourceZipUrl?: string;
  fileCount?: number;
  language?: string;
  framework?: string;
  error?: string;
}

export interface ICodeGenerator {
  generateSource(input: CodeGenInput): Promise<CodeGenResult>;
}

export interface IDeploymentConfigGenerator {
  generateConfig(input: CodeGenInput): Promise<CodeGenResult>;
}
