/**
 * 交付队列（BullMQ）：队列名、job 名与 payload 类型单独成文，避免 service ↔ processor 循环 import。
 * 同一队列承载两类长任务，用 job.name 区分：终稿生产交付、批量修复 + 重新评估。
 * 取代原 fire-and-forget（进程重启即丢任务）；状态仍由各自的 DB 字段轮询暴露。
 */
export const DELIVERY_QUEUE = 'delivery';

export const PRODUCTION_DELIVERY_JOB = 'production-delivery';
export const RE_EVALUATE_JOB = 're-evaluate';

export interface ProductionDeliveryJob {
  deliveryId: string;
  projectId: string;
  payload: { projectName: string; planSummary: any; demoHtml: string };
}

export interface ReEvaluateJob {
  taskId: string;
  projectId: string;
  sr: any;
  queue: any[];
  demoHtml: string;
  planSummary: any;
  description: string | null;
}
