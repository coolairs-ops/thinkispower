/**
 * 守护巡检队列（BullMQ）。
 * sweep：定时(repeatable)扫描已上线项目并逐个入队 check；
 * check：对单个项目跑一次验收巡检，落 GuardianCheck。
 */
export const GUARDIAN_QUEUE = 'guardian';

export const GUARDIAN_SWEEP_JOB = 'guardian-sweep';
export const GUARDIAN_CHECK_JOB = 'guardian-check';

export interface GuardianCheckJob {
  projectId: string;
  trigger?: 'scheduled' | 'manual';
}
