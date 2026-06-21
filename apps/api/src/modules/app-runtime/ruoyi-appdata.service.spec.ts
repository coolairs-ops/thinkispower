import { RuoyiAppDataService } from './ruoyi-appdata.service';

// 烘焙了 /api/app 客户端的前端（A 架构下 serve 时**保留不动**，只追加登录门）
const baked = '<head><script>/* appData: 已部署应用数据接口客户端 (ADR-0001) */\nvar BASE="/api/app/p1/";</script></head><body>x</body>';

describe('RuoyiAppDataService（serve 层·A 架构：注登录门，不再注 admin token）', () => {
  const enabledEnv = { RUOYI_BASE_URL: 'http://127.0.0.1:8080', RUOYI_SRC_ROOT: 'D:/ruoyi-study' };

  function make(env: Record<string, string | undefined>) {
    const orig = process.env;
    process.env = { ...orig, ...env } as NodeJS.ProcessEnv;
    const svc = new RuoyiAppDataService();
    process.env = orig;
    return svc;
  }

  it('非若依后端 → 原样返回', async () => {
    const svc = make(enabledEnv);
    expect(await svc.transform(baked, { kind: 'crud' })).toBe(baked);
  });

  it('若依已就绪 → 保留 /api/app 客户端 + 注入登录门，且**不**注 admin token', async () => {
    const svc = make(enabledEnv);
    const out = (await svc.transform(baked, { kind: 'ruoyi', status: 'ready' }, '客户系统')) as string;
    expect(out).toContain('/api/app/p1/'); // 路B 客户端保留（不再被剥）
    expect(out).toContain('tip-login-gate'); // 登录门注入
    expect(out).toContain('"客户系统"'); // appName 注入登录门（运行时拼成标题"登录 客户系统"）
    expect(out).not.toContain('__RUOYI_TOKEN__'); // 安全：浏览器不放若依 token
  });

  it('置备中(status=provisioning) → 仍走路B，不注门（避免显示尚不存在的数据）', async () => {
    const svc = make(enabledEnv);
    expect(await svc.transform(baked, { kind: 'ruoyi', status: 'provisioning' })).toBe(baked);
  });

  it('未配实例 → enabled=false，原样返回', async () => {
    const svc = make({ RUOYI_BASE_URL: undefined, RUOYI_SRC_ROOT: undefined });
    expect(svc.enabled).toBe(false);
    expect(await svc.transform(baked, { kind: 'ruoyi', status: 'ready' })).toBe(baked);
  });

  it('空 html → 原样返回', async () => {
    const svc = make(enabledEnv);
    expect(await svc.transform(null, { kind: 'ruoyi', status: 'ready' })).toBeNull();
  });
});
