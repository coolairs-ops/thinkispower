import { createServer, Server } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { resolveConsoleServeConfig, createConsoleServer } from './console-serve';

describe('resolveConsoleServeConfig', () => {
  it('默认关闭（未设 RUOYI_CONSOLE_SERVE）→ null', () => {
    expect(resolveConsoleServeConfig({})).toBeNull();
    expect(resolveConsoleServeConfig({ RUOYI_CONSOLE_SERVE: 'off' })).toBeNull();
  });

  it('managed 模式 + 默认值（无显式 publicUrl）', () => {
    const cfg = resolveConsoleServeConfig({ RUOYI_CONSOLE_SERVE: 'managed' });
    expect(cfg).toEqual({ host: '127.0.0.1', port: 8089, apiPrefix: '/prod-api', publicUrl: undefined });
  });

  it('尊重 env 覆盖并规范化前缀/publicUrl 尾斜杠', () => {
    const cfg = resolveConsoleServeConfig({
      RUOYI_CONSOLE_SERVE: 'managed',
      RUOYI_CONSOLE_SERVE_HOST: '0.0.0.0',
      RUOYI_CONSOLE_SERVE_PORT: '9000',
      RUOYI_CONSOLE_API_PREFIX: 'api/',
      RUOYI_CONSOLE_PUBLIC_URL: 'https://console.acme.com/',
    });
    expect(cfg).toEqual({ host: '0.0.0.0', port: 9000, apiPrefix: '/api', publicUrl: 'https://console.acme.com' });
  });
});

describe('createConsoleServer', () => {
  let distDir: string;
  let backend: Server;
  let backendUrl: string;
  let server: Server;

  beforeAll((done) => {
    // 临时 dist：index.html + 一个静态资源
    distDir = mkdtempSync(join(tmpdir(), 'console-dist-'));
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>console</title>');
    writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log(1)');

    // 桩后端：回显收到的方法与路径
    backend = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, path: req.url }));
    });
    backend.listen(0, '127.0.0.1', () => {
      backendUrl = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
      server = createConsoleServer({ distDir, backendUrl, apiPrefix: '/prod-api' });
      done();
    });
  });

  afterAll(() => {
    backend.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it('根路径 → index.html', async () => {
    const r = await request(server).get('/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<title>console</title>');
    expect(r.headers['content-type']).toContain('text/html');
  });

  it('静态资源命中并带正确 mime', async () => {
    const r = await request(server).get('/assets/app.js');
    expect(r.status).toBe(200);
    expect(r.text).toBe('console.log(1)');
    expect(r.headers['content-type']).toContain('text/javascript');
  });

  it('无扩展名路由 → SPA fallback 到 index.html', async () => {
    const r = await request(server).get('/system/user');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<title>console</title>');
  });

  it('带扩展名却缺文件 → 404（不掩盖构建缺资源）', async () => {
    const r = await request(server).get('/assets/missing.js');
    expect(r.status).toBe(404);
  });

  it('目录穿越 → 403', async () => {
    const r = await request(server).get('/..%2f..%2fetc%2fpasswd');
    expect([403, 404]).toContain(r.status); // 规范化后越界 → 403（部分客户端先折叠路径 → 404，均安全）
  });

  it('畸形 %xx 编码 → 400（不挂起）', async () => {
    const r = await request(server).get('/%E0%A4%A');
    expect(r.status).toBe(400);
  });

  it('代理：剥前缀后转发到后端（GET）', async () => {
    const r = await request(server).get('/prod-api/system/user/list?pageNum=1');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ method: 'GET', path: '/system/user/list?pageNum=1' });
  });

  it('代理：透传 POST 与 body', async () => {
    const r = await request(server).post('/prod-api/auth/login').send({ username: 'u1' });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({ method: 'POST', path: '/auth/login' });
  });
});
