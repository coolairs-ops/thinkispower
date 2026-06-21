import { RuoyiAppDataService } from './ruoyi-appdata.service';

const ruoyiBaked = '<head><script>/* appData: 已部署应用数据接口客户端 (ADR-0001) */\nvar BASE="/api/app/p1/";</script></head><body>x</body>';

describe('RuoyiAppDataService（serve 层按 backendRuntime 切 appData）', () => {
  const enabledEnv = { RUOYI_BASE_URL: 'http://127.0.0.1:8080', RUOYI_SRC_ROOT: 'D:/ruoyi-study' };

  function make(env: Record<string, string | undefined>, login = jest.fn().mockResolvedValue('tok-xyz')) {
    const orig = process.env;
    process.env = { ...orig, ...env } as NodeJS.ProcessEnv;
    const svc = new RuoyiAppDataService({ login } as never);
    process.env = orig;
    return { svc, login };
  }

  it('非若依后端 → 原样返回，不登录', async () => {
    const { svc, login } = make(enabledEnv);
    const out = await svc.transform(ruoyiBaked, { kind: 'crud' });
    expect(out).toBe(ruoyiBaked);
    expect(login).not.toHaveBeenCalled();
  });

  it('若依已就绪 → 去路B appData、注若依 appData + token', async () => {
    const { svc, login } = make(enabledEnv);
    const out = (await svc.transform(ruoyiBaked, { kind: 'ruoyi', status: 'ready' })) as string;
    expect(out).not.toContain('/api/app/p1/'); // 路B appData 被剥掉
    expect(out).toContain('若依后端数据接口客户端'); // 若依 appData 注入
    expect(out).toContain('window.__RUOYI_TOKEN__="tok-xyz"');
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('置备中(status=provisioning) → 仍走路B，不切若依（避免显示尚不存在的数据）', async () => {
    const { svc, login } = make(enabledEnv);
    expect(await svc.transform(ruoyiBaked, { kind: 'ruoyi', status: 'provisioning' })).toBe(ruoyiBaked);
    expect(login).not.toHaveBeenCalled();
  });

  it('token 缓存：连续两次只登录一次', async () => {
    const { svc, login } = make(enabledEnv);
    await svc.transform(ruoyiBaked, { kind: 'ruoyi', status: 'ready' });
    await svc.transform(ruoyiBaked, { kind: 'ruoyi', status: 'ready' });
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('未配实例 → enabled=false，原样返回', async () => {
    const { svc, login } = make({ RUOYI_BASE_URL: undefined, RUOYI_SRC_ROOT: undefined });
    expect(svc.enabled).toBe(false);
    expect(await svc.transform(ruoyiBaked, { kind: 'ruoyi', status: 'ready' })).toBe(ruoyiBaked);
    expect(login).not.toHaveBeenCalled();
  });

  it('登录失败 → 退回原 html（不让页面打不开）', async () => {
    const { svc } = make(enabledEnv, jest.fn().mockRejectedValue(new Error('login down')));
    expect(await svc.transform(ruoyiBaked, { kind: 'ruoyi', status: 'ready' })).toBe(ruoyiBaked);
  });

  it('空 html → 原样返回', async () => {
    const { svc } = make(enabledEnv);
    expect(await svc.transform(null, { kind: 'ruoyi', status: 'ready' })).toBeNull();
  });
});
