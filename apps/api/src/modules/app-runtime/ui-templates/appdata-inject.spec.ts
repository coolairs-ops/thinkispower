import * as vm from 'vm';
import { injectAppData } from './appdata-inject';

describe('injectAppData', () => {
  it('可关闭内置登录弹层（Demo 预览不被 401 登录门挡住）', () => {
    const html = injectAppData('<html><head></head><body></body></html>', 'proj-1', { authGate: false });
    expect(html).toContain('window.appData');
    expect(html).not.toContain('tip-auth');
    expect(html).not.toContain('mountGate');
  });

  it('localStorage 不可用时，用 window.name 兜底保存 session（适配 srcDoc iframe 预览）', async () => {
    const html = injectAppData('<html><head></head><body></body></html>', 'proj-1');
    const iife = html.match(/\(function\(\)\{[\s\S]*\}\)\(\);/)![0];
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
    const fetchMock = (url: string, opts: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ session: 'sess-name', data: [], total: 0 }) });
    };
    const ctx: Record<string, unknown> = {
      window: { name: '' },
      document: { readyState: 'loading', addEventListener: jest.fn() },
      encodeURIComponent,
      fetch: fetchMock,
    };
    vm.createContext(ctx);
    vm.runInContext(iife, ctx);
    const appData = (ctx.window as any).appData;

    await appData.login('zhangsan', 'pw');
    expect(appData.isLoggedIn()).toBe(true);
    expect((ctx.window as any).name).toContain('sess-name');

    const reloadCtx: Record<string, unknown> = {
      window: { name: (ctx.window as any).name },
      document: { readyState: 'loading', addEventListener: jest.fn() },
      encodeURIComponent,
      fetch: fetchMock,
    };
    vm.createContext(reloadCtx);
    vm.runInContext(iife, reloadCtx);
    const reloadedAppData = (reloadCtx.window as any).appData;

    expect(reloadedAppData.isLoggedIn()).toBe(true);
    await reloadedAppData.list('todo', {});
    const last = calls[calls.length - 1];
    expect(last.headers['x-app-session']).toBe('sess-name');
  });

  it('iframe reload 后自身状态丢失时，可从父页面内存恢复 session', async () => {
    const html = injectAppData('<html><head></head><body></body></html>', 'proj-1');
    const iife = html.match(/\(function\(\)\{[\s\S]*\}\)\(\);/)![0];
    const parentWindow: Record<string, unknown> = {};
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
    const fetchMock = (url: string, opts: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ session: 'sess-parent', data: [], total: 0 }) });
    };
    const ctx: Record<string, unknown> = {
      window: { name: '', parent: parentWindow },
      document: { readyState: 'loading', addEventListener: jest.fn() },
      encodeURIComponent,
      fetch: fetchMock,
    };
    vm.createContext(ctx);
    vm.runInContext(iife, ctx);
    await (ctx.window as any).appData.login('zhangsan', 'pw');

    const reloadCtx: Record<string, unknown> = {
      window: { name: '', parent: parentWindow },
      document: { readyState: 'loading', addEventListener: jest.fn() },
      encodeURIComponent,
      fetch: fetchMock,
    };
    vm.createContext(reloadCtx);
    vm.runInContext(iife, reloadCtx);
    const reloadedAppData = (reloadCtx.window as any).appData;

    expect(reloadedAppData.isLoggedIn()).toBe(true);
    await reloadedAppData.list('todo', {});
    const last = calls[calls.length - 1];
    expect(last.headers['x-app-session']).toBe('sess-parent');
  });
});
