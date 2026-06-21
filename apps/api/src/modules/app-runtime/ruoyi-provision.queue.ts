import { AppSpec } from './app-spec.types';

/**
 * 若依 provision 队列（BullMQ）。
 * provision 含分钟级编译/重启，必须后台跑——端点入队即返回 jobId，不阻塞请求（build-worker 入队，非同步）。
 */
export const RUOYI_PROVISION_QUEUE = 'ruoyi-provision';
export const RUOYI_PROVISION_JOB = 'ruoyi-provision';

export interface RuoyiProvisionJob {
  projectId: string;
  spec: AppSpec;
}
