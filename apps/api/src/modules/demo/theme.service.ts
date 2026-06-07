import { Injectable } from '@nestjs/common';

/** demo 外观主题（Phase A 最小验证：风格大面之「颜色 / 明暗 / 圆角」） */
export interface ThemeConfig {
  /** 主色（#rrggbb），用于非 daisyUI 存量 demo 的覆盖层 */
  primary: string;
  /** 明暗 */
  mode: 'light' | 'dark';
  /** 圆角（px，0-32） */
  radius: number;
  /** daisyUI 主题名，用于 daisyUI 化的 demo（一键换肤） */
  daisyTheme: string;
}

/** 支持的 daisyUI 主题白名单（与前端风格预设映射对应） */
export const DAISY_THEMES = ['light', 'dark', 'corporate', 'business', 'winter', 'night', 'luxury', 'emerald', 'cupcake', 'cyberpunk'];

export const DEFAULT_THEME: ThemeConfig = { primary: '#2563eb', mode: 'light', radius: 8, daisyTheme: 'corporate' };

/**
 * 主题服务（Phase A）：把 demo 的「皮肤」与「骨架」分离。
 *
 * 思路——不改 AI 生成的 HTML 内容，而是**追加一层主题覆盖样式**：用一段固定 CSS 把核心视觉面
 * (页面背景/文字、按钮与链接主色、圆角、深色容器表面) 绑定到 `:root` 的 `--tip-*` 令牌。
 * 改令牌即整页即时变样、零 AI、零漂移；对任意存量 demo 都生效（不依赖 AI 是否用了变量）。
 *
 * 覆盖层用 `!important` + 通配选择器抓「核心面」(约 80% 视觉)，不追求 100% 收敛——
 * AI 用非标准结构处可能覆盖不到，属已知取舍，后续可细化选择器或在生成契约中要求用变量。
 */
@Injectable()
export class ThemeService {
  /** 校验并兜底主题配置 */
  normalize(c?: Partial<ThemeConfig> | null): ThemeConfig {
    const primary =
      typeof c?.primary === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.primary) ? c.primary : DEFAULT_THEME.primary;
    const mode = c?.mode === 'dark' ? 'dark' : 'light';
    const r = Number(c?.radius);
    const radius = Number.isFinite(r) ? Math.min(32, Math.max(0, Math.round(r))) : DEFAULT_THEME.radius;
    const daisyTheme =
      typeof c?.daisyTheme === 'string' && DAISY_THEMES.includes(c.daisyTheme) ? c.daisyTheme : DEFAULT_THEME.daisyTheme;
    return { primary, mode, radius, daisyTheme };
  }

  /** 生成主题覆盖层 `<style id="tip-theme">`（含 :root 令牌 + 核心面绑定） */
  buildThemeCss(input?: Partial<ThemeConfig> | null): string {
    const { primary, mode, radius } = this.normalize(input);
    const dark = mode === 'dark';
    const bg = dark ? '#0f172a' : '#ffffff';
    const text = dark ? '#e5e7eb' : '#1f2937';
    const surface = dark ? '#1e293b' : '#f8fafc';
    const border = dark ? '#334155' : '#e5e7eb';

    // 深色模式下把常见容器拉到表面色，避免白底突兀（仅 dark 输出，避免误伤浅色设计）
    const darkContainers = dark
      ? `
  nav, aside, header, [class*="card"], [class*="panel"], [class*="sidebar"], [class*="header"] {
    background-color: var(--tip-surface) !important; border-color: var(--tip-border) !important;
  }`
      : '';

    return `<style id="tip-theme">
:root{
  --tip-primary: ${primary};
  --tip-on-primary: #ffffff;
  --tip-radius: ${radius}px;
  --tip-bg: ${bg};
  --tip-text: ${text};
  --tip-surface: ${surface};
  --tip-border: ${border};
}
body{ background-color: var(--tip-bg) !important; color: var(--tip-text) !important; }
a{ color: var(--tip-primary) !important; }
button, .btn, [class*="btn"], [class*="button"], input[type="submit"], input[type="button"]{
  background-color: var(--tip-primary) !important; color: var(--tip-on-primary) !important;
  border-color: var(--tip-primary) !important; border-radius: var(--tip-radius) !important;
}
input, select, textarea, [class*="card"], [class*="panel"], table{ border-radius: var(--tip-radius) !important; }${darkContainers}
</style>`;
  }

  /** 把主题覆盖层注入 HTML（先移除旧的，保证幂等）。注入到 </head> 前；无 head 则 body 起始；再无则置顶。 */
  applyTheme(html: string, config?: Partial<ThemeConfig> | null): string {
    const c = this.normalize(config);
    // daisyUI 化的 demo：切 data-theme（成熟主题体系），不注覆盖层，避免 !important 盖掉 daisyUI 主题色
    if (/daisyui/i.test(html || '')) {
      return this.setDataTheme(html || '', c.daisyTheme);
    }
    // 非 daisyUI（存量 / 裸 HTML）：注入覆盖层兜底
    const css = this.buildThemeCss(c);
    const stripped = (html || '').replace(/<style id="tip-theme">[\s\S]*?<\/style>/g, '');
    if (/<\/head>/i.test(stripped)) return stripped.replace(/<\/head>/i, `${css}\n</head>`);
    if (/<body[^>]*>/i.test(stripped)) return stripped.replace(/(<body[^>]*>)/i, `$1${css}`);
    return css + stripped;
  }

  /** 把 <html> 的 data-theme 设为指定 daisyUI 主题（无该属性则添加） */
  private setDataTheme(html: string, theme: string): string {
    if (/<html[^>]*\bdata-theme=/i.test(html)) {
      return html.replace(/(<html[^>]*\bdata-theme=")[^"]*(")/i, `$1${theme}$2`);
    }
    if (/<html[^>]*>/i.test(html)) {
      return html.replace(/(<html)([^>]*>)/i, `$1 data-theme="${theme}"$2`);
    }
    return html;
  }
}
