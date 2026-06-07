import { ThemeService, DEFAULT_THEME } from './theme.service';

describe('ThemeService', () => {
  let s: ThemeService;
  beforeEach(() => { s = new ThemeService(); });

  describe('normalize', () => {
    it('合法值原样保留', () => {
      expect(s.normalize({ primary: '#ff0000', mode: 'dark', radius: 12, daisyTheme: 'dark' })).toEqual({ primary: '#ff0000', mode: 'dark', radius: 12, daisyTheme: 'dark' });
    });
    it('非法 hex/mode → 兜底默认；radius 超界 → clamp', () => {
      expect(s.normalize({ primary: 'red', mode: 'x' as never, radius: 999 })).toEqual({ primary: DEFAULT_THEME.primary, mode: 'light', radius: 32, daisyTheme: 'corporate' });
      expect(s.normalize({ primary: '#000000', mode: 'light', radius: -5 }).radius).toBe(0);
    });
    it('daisyTheme 白名单校验：未知主题兜底 corporate', () => {
      expect(s.normalize({ daisyTheme: 'cyberpunk' } as never).daisyTheme).toBe('cyberpunk');
      expect(s.normalize({ daisyTheme: 'not-a-theme' } as never).daisyTheme).toBe('corporate');
    });
    it('空 → 默认主题', () => {
      expect(s.normalize(undefined)).toEqual(DEFAULT_THEME);
      expect(s.normalize(null)).toEqual(DEFAULT_THEME);
    });
  });

  describe('buildThemeCss', () => {
    it('含 tip-theme 与令牌变量', () => {
      const css = s.buildThemeCss({ primary: '#abcdef', mode: 'light', radius: 6 });
      expect(css).toContain('id="tip-theme"');
      expect(css).toContain('--tip-primary: #abcdef');
      expect(css).toContain('--tip-radius: 6px');
      expect(css).toContain('--tip-bg: #ffffff');
    });
    it('dark 模式用深色背景 + 容器表面覆盖', () => {
      const css = s.buildThemeCss({ primary: '#000000', mode: 'dark', radius: 8 });
      expect(css).toContain('--tip-bg: #0f172a');
      expect(css).toContain('var(--tip-surface)');
    });
  });

  describe('applyTheme', () => {
    it('注入到 </head> 之前', () => {
      const out = s.applyTheme('<html><head><title>x</title></head><body>hi</body></html>', DEFAULT_THEME);
      expect(out).toContain('id="tip-theme"');
      expect(out.indexOf('id="tip-theme"')).toBeLessThan(out.indexOf('</head>'));
    });
    it('幂等：重复注入只保留一份且用最新值', () => {
      const once = s.applyTheme('<html><head></head><body></body></html>', { primary: '#111111', mode: 'light', radius: 8 });
      const twice = s.applyTheme(once, { primary: '#222222', mode: 'light', radius: 8 });
      expect((twice.match(/id="tip-theme"/g) || []).length).toBe(1);
      expect(twice).toContain('--tip-primary: #222222');
      expect(twice).not.toContain('#111111');
    });
    it('无 head → 注入 body 起始', () => {
      const out = s.applyTheme('<body>x</body>', DEFAULT_THEME);
      expect(out).toContain('id="tip-theme"');
      expect(out.indexOf('id="tip-theme"')).toBeLessThan(out.indexOf('x'));
    });
    it('无 head/body → 置顶注入', () => {
      const out = s.applyTheme('<div>x</div>', DEFAULT_THEME);
      expect(out.startsWith('<style id="tip-theme">')).toBe(true);
    });

    it('daisyUI 化的 html → 改 data-theme，不注覆盖层', () => {
      const html = '<html data-theme="corporate"><head><link href="https://cdn.jsdelivr.net/npm/daisyui@4/dist/full.min.css"></head><body></body></html>';
      const out = s.applyTheme(html, { primary: '#000000', mode: 'dark', radius: 0, daisyTheme: 'cyberpunk' });
      expect(out).toContain('data-theme="cyberpunk"');
      expect(out).not.toContain('id="tip-theme"');
    });

    it('daisyUI html 无 data-theme → 给 <html> 添加', () => {
      const html = '<html><head><link href="/daisyui.css"></head><body></body></html>';
      const out = s.applyTheme(html, { primary: '#000000', mode: 'light', radius: 8, daisyTheme: 'business' });
      expect(out).toContain('data-theme="business"');
    });
  });
});
