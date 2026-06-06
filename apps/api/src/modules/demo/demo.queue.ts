/** 预览生成队列（BullMQ）：常量与 job 类型单独成文，避免 service ↔ processor 循环 import */
export const DEMO_QUEUE = 'demo-generate';

export interface DemoGenerateJob {
  projectId: string;
}
