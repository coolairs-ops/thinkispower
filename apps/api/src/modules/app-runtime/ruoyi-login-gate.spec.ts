import * as vm from 'node:vm';
import { buildLoginGateScript, injectLoginGate } from './ruoyi-login-gate';

/** 极简 DOM 桩：够跑 boot()/show() 的分支判定（不验真实渲染，那留给 live/preview）。 */
function makeCtx(appData: unknown) {
  const node = (): any => ({
    id: '', style: { cssText: '' }, innerHTML: '',
    setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {},
    value: '', focus() {}, querySelector: () => node(),
  });
  const body = { appendChild: jest.fn() };
  const winListeners: Record<string, (...a: unknown[]) => void> = {};
  const win: any = {
    appData,
    addEventListener: (ev: string, fn: (...a: unknown[]) => void) => { winListeners[ev] = fn; },
    dispatchEvent: () => true,
  };
  const ctx: any = {
    window: win,
    document: { readyState: 'complete', body, createElement: () => node(), getElementById: () => null, addEventListener() {}, querySelector: () => node() },
    location: { reload: jest.fn() },
    setTimeout: () => 0,
  };
  return { ctx, body, winListeners };
}

function run(appData: unknown) {
  const { ctx, body, winListeners } = makeCtx(appData);
  const script = buildLoginGateScript('客户系统').replace(/^<script>|<\/script>$/g, '');
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return { body, winListeners };
}

describe('ruoyi-login-gate（终端用户登录门 P1b）', () => {
  it('builder 含关键接线：自动弹/401事件/调 login/成功 reload/登录态判定', () => {
    const s = buildLoginGateScript('客户系统');
    expect(s).toContain("addEventListener('tip:auth-required'");
    expect(s).toContain('window.appData.login(u,p)');
    expect(s).toContain('location.reload()');
    expect(s).toContain('isLoggedIn');
    expect(s).toContain('tip-login-ov');
    expect(s).toContain('value="ceshi"');
    expect(s).toContain('value="ceshi123"');
    expect(s).toContain('登录 '); // 标题用 appName
    expect(s).toContain('"客户系统"'); // appName 经 JSON.stringify 转义注入
  });

  it('injectLoginGate 注入到 </body> 前', () => {
    const out = injectLoginGate('<html><body><h1>x</h1></body></html>', '应用');
    expect(out).toContain('tip-login-gate');
    expect(out.indexOf('tip-login-gate')).toBeLessThan(out.indexOf('</body>'));
  });

  it('未登录 → 自动弹登录框（body.appendChild 被调）', () => {
    const { body } = run({ login: () => {}, isLoggedIn: () => false });
    expect(body.appendChild).toHaveBeenCalledTimes(1);
  });

  it('已登录 → 不弹', () => {
    const { body } = run({ login: () => {}, isLoggedIn: () => true });
    expect(body.appendChild).not.toHaveBeenCalled();
  });

  it('使用中收到 tip:auth-required（session 过期）→ 弹登录框', () => {
    const { body, winListeners } = run({ login: () => {}, isLoggedIn: () => true });
    expect(body.appendChild).not.toHaveBeenCalled(); // 起初已登录不弹
    winListeners['tip:auth-required']?.(); // 模拟 401 事件
    expect(body.appendChild).toHaveBeenCalledTimes(1);
  });
});
