/**
 * 导出执行器接口。
 *
 * 同事实现 IExportExecutor 接口来处理具体的导出任务，
 * 在 DeliveryOrchestrator 中注册。
 */

export type ExportType = 'source' | 'package' | 'repository' | 'database' | 'deployment';

export interface ExportInput {
  projectId: string;
  buildId: string;
  exportType: ExportType;
}

export interface ExportResult {
  success: boolean;
  artifactUrl?: string;
  error?: string;
}

export interface IExportExecutor {
  execute(input: ExportInput): Promise<ExportResult>;
}
