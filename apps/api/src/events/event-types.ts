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
  feedbackId: string;
  taskIds: string[];
}

export interface TasksCompletedPayload {
  projectId: string;
  feedbackId: string;
  newHtml?: string;
}

export interface TaskFailedPayload {
  projectId: string;
  feedbackId: string;
  taskId: string;
  error: string;
}

// ===== Delivery Payloads =====
export type ExportType = 'source' | 'package' | 'repository' | 'database' | 'deployment';

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
