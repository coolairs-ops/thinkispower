import { loadRuoyiInstanceConfig, RuoyiInstanceConfig } from './ruoyi-provision.config';

export interface ConsoleSmokeResult {
  ok: boolean;
  statusCode?: number;
  detail: string;
}

/**
 * 经控制台 URL 的代理冒烟：用初始用户(无则 admin)登录 + 首个业务资源 list 返 200。
 *
 * 关键：必须走**控制台前端的访问路径**(consoleUrl + apiPrefix)，而非 API 直连若依——
 * 否则测不出"控制台→后端"断链(preview 缺代理 / 加密开关不匹配 / CORS)，会把"首页 200 但真人登不上去"
 * 误判成健康(2026-06-28 实测坑)。交付上线门(ruoyi-console-deploy)与守护探活(guardian)共用，避免漂移。
 *
 * @param timeoutMs 设了才给每个 fetch 加超时(守护周期探活要;交付冒烟保留原无超时行为)。
 */
export async function smokeRuoyiConsole(
  consoleUrl: string,
  desc: { resources?: string[]; initialUsers?: Array<{ userName: string; password: string }> },
  opts: { cfg?: RuoyiInstanceConfig; timeoutMs?: number } = {},
): Promise<ConsoleSmokeResult> {
  const cfg = opts.cfg ?? loadRuoyiInstanceConfig();
  const signal = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined;
  const apiPrefix = process.env.RUOYI_CONSOLE_API_PREFIX || '/prod-api';
  const base = `${consoleUrl.replace(/\/$/, '')}${apiPrefix}`;
  const u = desc.initialUsers?.[0];
  const username = u?.userName ?? cfg.client.username;
  const password = u?.password ?? cfg.client.password;
  const hdr = { 'Content-Type': 'application/json', clientid: cfg.client.clientId };
  try {
    const lr = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({ tenantId: cfg.client.tenantId, username, password, grantType: 'password', clientId: cfg.client.clientId }),
      signal,
    });
    const lj = (await lr.json()) as { code?: number; data?: { access_token?: string } };
    if (lj?.code !== 200 || !lj.data?.access_token) {
      return { ok: false, statusCode: lr.status, detail: `经代理登录失败 code=${lj?.code}` };
    }
    const resource = (desc.resources ?? [])[0];
    if (!resource) return { ok: true, detail: '登录通(无业务资源可 list)' };
    const rr = await fetch(`${base}/system/${resource}/list?pageNum=1&pageSize=1`, {
      headers: { Authorization: `Bearer ${lj.data.access_token}`, clientid: cfg.client.clientId },
      signal,
    });
    return { ok: rr.status === 200, statusCode: rr.status, detail: rr.status === 200 ? `登录+list ${resource} 200` : `经代理 list ${resource} HTTP ${rr.status}` };
  } catch (e) {
    return { ok: false, detail: `经代理冒烟失败(${base}): ${e instanceof Error ? e.message : e}` };
  }
}
