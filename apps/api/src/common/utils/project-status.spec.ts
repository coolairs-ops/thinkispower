import { isProjectLocked, LOCKED_PROJECT_STATUSES } from './project-status';

describe('isProjectLocked', () => {
  it('developing / completed 为锁定态（已进入开发/交付，禁止回退）', () => {
    expect(isProjectLocked('developing')).toBe(true);
    expect(isProjectLocked('completed')).toBe(true);
  });

  it('demo 阶段等非终态不锁定（允许确认方案/重新生成预览）', () => {
    for (const s of [
      'needs_input', 'prd_ready', 'plan_ready', 'spec_confirmed',
      'demo_generating', 'demo_ready', 'awaiting_demo_feedback', 'demo_failed',
    ]) {
      expect(isProjectLocked(s)).toBe(false);
    }
  });

  it('null / undefined 不锁定', () => {
    expect(isProjectLocked(null)).toBe(false);
    expect(isProjectLocked(undefined)).toBe(false);
  });

  it('LOCKED_PROJECT_STATUSES = [developing, completed]', () => {
    expect(LOCKED_PROJECT_STATUSES).toEqual(['developing', 'completed']);
  });
});
