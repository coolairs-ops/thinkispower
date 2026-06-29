import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsoleServeService } from './console-serve.service';

describe('ConsoleServeService', () => {
  const ORIG = { ...process.env };
  let uiRoot: string; // 传入的是 plus-ui 根；服务内部找 uiRoot/dist/index.html

  beforeAll(() => {
    uiRoot = mkdtempSync(join(tmpdir(), 'console-svc-'));
    mkdirSync(join(uiRoot, 'dist'));
    writeFileSync(join(uiRoot, 'dist', 'index.html'), '<!doctype html><title>served</title>');
  });
  afterEach(() => {
    process.env = { ...ORIG };
  });
  afterAll(() => {
    rmSync(uiRoot, { recursive: true, force: true });
  });

  it('未开启托管模式 → null', async () => {
    const svc = new ConsoleServeService();
    expect(await svc.ensureServed(uiRoot, 'http://127.0.0.1:8080')).toBeNull();
  });

  it('dist 缺 index.html → null', async () => {
    process.env.RUOYI_CONSOLE_SERVE = 'managed';
    const svc = new ConsoleServeService();
    const empty = mkdtempSync(join(tmpdir(), 'console-empty-'));
    expect(await svc.ensureServed(empty, 'http://127.0.0.1:8080')).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });

  it('managed：起服务、产出 URL、实地可访问、幂等复用，destroy 关闭', async () => {
    process.env.RUOYI_CONSOLE_SERVE = 'managed';
    process.env.RUOYI_CONSOLE_SERVE_PORT = '0'; // 临时端口，免端口竞争；URL 由实际监听端口产出
    const svc = new ConsoleServeService();

    const url = await svc.ensureServed(uiRoot, 'http://127.0.0.1:8080');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // 实地 HTTP 验证（live：经真实监听端口拿到 index.html）
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>served</title>');

    // 幂等：第二次同 URL，不重起
    expect(await svc.ensureServed(uiRoot, 'http://127.0.0.1:8080')).toBe(url);

    svc.onModuleDestroy();
    // 关闭后不再可达
    await expect(fetch(`${url}/`, { signal: AbortSignal.timeout(1000) })).rejects.toBeDefined();
  });
});
