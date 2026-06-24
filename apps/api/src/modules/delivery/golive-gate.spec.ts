import { decideDeliveryOutcome } from './golive-gate';

const base = { compilationPassed: true, deployStatus: 'deploy_failed' as const, staticUrl: 'http://host/api/deploy/p' };

describe('decideDeliveryOutcome（上线门确定性二值合取 · ADR-0009）', () => {
  it('编译不过 → build_failed，不给上线 URL', () => {
    const r = decideDeliveryOutcome({ ...base, compilationPassed: false, deployStatus: 'deployed', deployedUrl: 'http://x' });
    expect(r.status).toBe('build_failed');
    expect(r.productionUrl).toBeNull();
  });

  it('编译过 + 部署健康 + 冒烟通过 → completed（真上线 URL）', () => {
    const r = decideDeliveryOutcome({ ...base, deployStatus: 'deployed', deployedUrl: 'http://live', smokePassed: true });
    expect(r.status).toBe('completed');
    expect(r.productionUrl).toBe('http://live');
  });

  it('部署健康但冒烟明确失败 → smoke_failed，不上线', () => {
    const r = decideDeliveryOutcome({ ...base, deployStatus: 'deployed', deployedUrl: 'http://live', smokePassed: false });
    expect(r.status).toBe('smoke_failed');
    expect(r.productionUrl).toBeNull();
  });

  it('部署健康 + 冒烟未覆盖(undefined) → 仍 completed（不因未验证而卡死）', () => {
    const r = decideDeliveryOutcome({ ...base, deployStatus: 'deployed', deployedUrl: 'http://live' });
    expect(r.status).toBe('completed');
  });

  it('未部署但若依后端就绪 → completed（前端交付+真后端）', () => {
    const r = decideDeliveryOutcome({ ...base, deployStatus: 'not_deployed', backendReady: true });
    expect(r.status).toBe('completed');
    expect(r.productionUrl).toBe(base.staticUrl);
  });

  it('Docker 不可用降级 static_only 且后端未就绪 → preview_only（仅预览·未上线，不冒充 completed）', () => {
    const r = decideDeliveryOutcome({ ...base, deployStatus: 'static_only' });
    expect(r.status).toBe('preview_only');
    expect(r.productionUrl).toBe(base.staticUrl);
  });

  it('部署失败且后端未就绪 → deploy_failed，不给上线 URL（绝不假阳性）', () => {
    const r = decideDeliveryOutcome({ ...base, deployStatus: 'deploy_failed' });
    expect(r.status).toBe('deploy_failed');
    expect(r.productionUrl).toBeNull();
  });

  it('核心红线：跑不起来的任何情形都不会得到 completed', () => {
    const notRunnable = [
      decideDeliveryOutcome({ ...base, compilationPassed: false }),
      decideDeliveryOutcome({ ...base, deployStatus: 'static_only' }),
      decideDeliveryOutcome({ ...base, deployStatus: 'deploy_failed' }),
      decideDeliveryOutcome({ ...base, deployStatus: 'deployed', deployedUrl: 'http://x', smokePassed: false }),
    ];
    expect(notRunnable.every((r) => r.status !== 'completed')).toBe(true);
  });
});
