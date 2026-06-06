import { ExecutorRouterService } from './executor-router.service';

describe('ExecutorRouterService.route', () => {
  const router = new ExecutorRouterService();

  it('security → claude-code 且强验证', () => {
    const d = router.route({ taskType: 'security' });
    expect(d.executor).toBe('claude-code');
    expect(d.requireStrongVerification).toBe(true);
  });

  it('database → claude-code 且强验证', () => {
    expect(router.route({ taskType: 'database' }).requireStrongVerification).toBe(true);
  });

  it('demo-preview → cloudecode 快速', () => {
    expect(router.route({ taskType: 'demo-preview' }).executor).toBe('cloudecode');
  });

  it('ui-tweak 低风险 → deepseek 轻量', () => {
    expect(router.route({ taskType: 'ui-tweak', riskLevel: 1 }).executor).toBe('deepseek');
  });

  it('ui-tweak 高风险(>=3) → 升级 claude-code', () => {
    expect(router.route({ taskType: 'ui-tweak', riskLevel: 3 }).executor).toBe('claude-code');
  });

  it('build-fix 低风险不强验证、高风险强验证', () => {
    expect(router.route({ taskType: 'build-fix', riskLevel: 1 }).requireStrongVerification).toBe(false);
    expect(router.route({ taskType: 'build-fix', riskLevel: 3 }).requireStrongVerification).toBe(true);
  });

  it('fullstack/frontend/backend → claude-code，风险>=4 强验证', () => {
    expect(router.route({ taskType: 'fullstack' }).executor).toBe('claude-code');
    expect(router.route({ taskType: 'backend', riskLevel: 4 }).requireStrongVerification).toBe(true);
    expect(router.route({ taskType: 'frontend', riskLevel: 2 }).requireStrongVerification).toBe(false);
  });

  it('未知类型 低风险 → cloudecode 兜底', () => {
    expect(router.route({ taskType: 'whatever' }).executor).toBe('cloudecode');
  });

  it('未知类型 高风险 → claude-code 保守', () => {
    expect(router.route({ taskType: 'whatever', riskLevel: 4 }).executor).toBe('claude-code');
  });

  it('风险等级超范围被收敛到 1–5', () => {
    expect(router.route({ taskType: 'ui-tweak', riskLevel: 99 }).executor).toBe('claude-code'); // 99→5，>=3 升级
    expect(router.route({ taskType: 'ui-tweak', riskLevel: 0 }).executor).toBe('deepseek'); // 0→1，<3
  });

  it('每个决策都带可读 reason', () => {
    expect(router.route({ taskType: 'security' }).reason).toMatch(/安全/);
  });
});
