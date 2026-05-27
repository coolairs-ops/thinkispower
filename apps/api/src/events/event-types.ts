// ===== Event names =====
export const EVENTS = {
  FEEDBACK_CREATED: 'feedback.created',
  TASKS_CREATED: 'tasks.created',
  TASKS_COMPLETED: 'tasks.completed',
  TASK_FAILED: 'task.failed',
  DELIVERY_EXPORT_REQUESTED: 'delivery.export.requested',
  DELIVERY_EXPORT_COMPLETED: 'delivery.export.completed',
  DELIVERY_EXPORT_FAILED: 'delivery.export.failed',
  BUILD_CREATED: 'build.created',
  DISCOVERY_PRD_READY: 'discovery.prd.ready',
  USER_CONFIRMED_PLAN: 'user.confirmed.plan',
} as const;

// ===== Payloads =====
export interface FeedbackCreatedPayload {
  feedbackId: string;
  projectId: string;
  comment: string;
  moduleKey?: string;
  elementPath?: string;
}

export interface TasksCreatedPayload {
  projectId: string;
  feedbackId?: string | null;
  taskIds: string[];
}

export interface TasksCompletedPayload {
  projectId: string;
  feedbackId?: string | null;
  newHtml?: string;
}

export interface TaskFailedPayload {
  projectId: string;
  feedbackId?: string | null;
  taskId: string;
  error: string;
}

// ===== Delivery Payloads =====
export type ExportType = 'source' | 'package' | 'repository' | 'database' | 'deployment';

/** 将 export_* 任务类型映射为 ExportType（export_source → source） */
export function taskTypeToExportType(taskType: string): ExportType | null {
  const map: Record<string, ExportType> = {
    export_source: 'source',
    export_package: 'package',
    export_repository: 'repository',
    export_database_schema: 'database',
    export_deployment_config: 'deployment',
  };
  return map[taskType] ?? null;
}

/** 将 ExportType 映射为任务类型（source → export_source） */
export function exportTypeToTaskType(exportType: ExportType): string {
  return `export_${exportType}`;
}

export interface DeliveryExportRequestedPayload {
  projectId: string;
  buildId: string;
  exportType: ExportType;
  userId: string;
}

export interface DeliveryExportCompletedPayload {
  projectId: string;
  buildId: string;
  exportType: ExportType;
  artifactUrl?: string;
}

export interface DeliveryExportFailedPayload {
  projectId: string;
  buildId: string;
  exportType: ExportType;
  error: string;
}

export interface BuildCreatedPayload {
  projectId: string;
  buildId: string;
  exportType: ExportType;
  version: number;
}

export interface DiscoveryPrdReadyPayload {
  projectId: string;
  prd: any;
}

export interface UserConfirmedPlanPayload {
  projectId: string;
  userId: string;
}
