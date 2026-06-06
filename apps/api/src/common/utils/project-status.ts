/**
 * 项目状态机 — 终态/锁定态判定。
 *
 * 这些状态表示项目已进入开发或交付阶段，不应被「确认方案 / 生成预览」等
 * 回退操作打回早期阶段（否则会丢弃已有成果、反复重做）。
 *
 * A（confirmPlan）先用上；B 将把它统一应用到所有回退入口（doGenerate / updatePlan 等）。
 */
export const LOCKED_PROJECT_STATUSES = ['developing', 'completed'] as const;

export function isProjectLocked(status: string | null | undefined): boolean {
  return !!status && (LOCKED_PROJECT_STATUSES as readonly string[]).includes(status);
}
