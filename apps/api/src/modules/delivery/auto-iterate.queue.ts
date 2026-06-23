/**
 * 自迭代队列（BullMQ）：单独成队列，与 delivery 队列隔离。
 * 自迭代是 10 轮、可达数分钟的长循环，若与生产交付/重评估共用单并发队列会形成
 * 队头阻塞（长循环占住唯一 worker 槽位 → 交付排队）。故独立队列、独立 processor。
 *
 * 取代原 fire-and-forget（`this.runAutoIterate(...).catch(...)`，进程重启即成孤儿：
 * 锁与 autoIterateState=running 残留、工作丢失）。job 持久化于 Redis，进程崩溃后
 * BullMQ stalled 机制把 job 拨回重跑；循环每轮从 DB 读最新 demoHtml，重跑即从上次
 * 已落盘的成果续进，天然可恢复。状态真相源仍是 Project.autoIterateState（前端对账）。
 */
export const AUTO_ITERATE_QUEUE = 'auto-iterate';

export const AUTO_ITERATE_JOB = 'auto-iterate';

export interface AutoIterateJob {
  taskId: string;
  projectId: string;
}
