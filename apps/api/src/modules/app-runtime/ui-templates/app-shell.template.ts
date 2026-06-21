import { getTheme, themeCssVars } from './theme-tokens';

export interface NavItem {
  key: string;
  label: string;
  icon: string; // Tabler 名（不带 ti- 前缀）
  active?: boolean;
}
export interface ShellConfig {
  appName: string;
  org?: string; // 副标题（单位名/企业名）
  themeId?: string;
  user?: string;
  nav: NavItem[];
  contentHtml: string;
}

/** HTML 转义（填槽防注入：所有外来文本经此再进模板）。 */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** 模板库基础组件 CSS——只读主题 var(--t-*)，与具体皮肤解耦。各页型复用这套类。 */
function baseCss(): string {
  return `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--t-surface);color:var(--t-text);font-size:14px;line-height:1.6}
.app{display:flex;flex-direction:column;min-height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 18px;background:var(--t-header-bg);color:var(--t-header-text)}
.brand{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:500}
.brand .dot{width:28px;height:28px;border-radius:7px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center}
.brand .sub{font-size:12px;color:var(--t-header-sub);font-weight:400}
.topbar .user{font-size:13px;color:var(--t-header-sub)}
.body{display:flex;flex:1;min-height:0}
.nav{width:172px;flex-shrink:0;background:var(--t-nav-bg);border-right:.5px solid var(--t-card-border);padding:10px 8px}
.nav a{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:7px;color:var(--t-nav-text);text-decoration:none;font-size:13px;margin-bottom:2px}
.nav a.active{background:var(--t-nav-active-bg);color:var(--t-nav-active-text)}
.content{flex:1;padding:20px;min-width:0}
.h1{font-size:17px;font-weight:500;margin-bottom:14px}
.card{background:var(--t-card);border:.5px solid var(--t-card-border);border-radius:12px;padding:16px}
.grid{display:grid;gap:12px}
.kpi{background:var(--t-card);border:.5px solid var(--t-card-border);border-radius:10px;padding:14px}
.kpi .l{font-size:13px;color:var(--t-text-2)}
.kpi .v{font-size:24px;font-weight:500;margin-top:4px}
.badge{font-size:12px;padding:2px 8px;border-radius:7px;display:inline-block}
.b-d{background:var(--t-danger-bg);color:var(--t-danger-text)}
.b-c{background:var(--t-warning-bg);color:var(--t-warning-text)}
.b-b{background:var(--t-info-bg);color:var(--t-info-text)}
.b-a{background:var(--t-success-bg);color:var(--t-success-text)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:400;color:var(--t-text-2);padding:8px 6px;border-bottom:.5px solid var(--t-card-border)}
td{padding:9px 6px;border-bottom:.5px solid var(--t-card-border)}
.muted{color:var(--t-text-2)}
.btn{height:34px;padding:0 14px;border-radius:8px;background:var(--t-primary);color:var(--t-primary-text);border:none;font-size:13px;cursor:pointer}`;
}

/** 装配一整页 App（确定性出 HTML）：主题 var + 基础 CSS + 顶栏 + 侧栏 + 内容槽。 */
export function renderShell(cfg: ShellConfig): string {
  const theme = getTheme(cfg.themeId);
  const navHtml = cfg.nav.map((n) =>
    `<a href="#${esc(n.key)}" class="${n.active ? 'active' : ''}"><i class="ti ti-${esc(n.icon)}"></i>${esc(n.label)}</a>`,
  ).join('');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.appName)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/tabler-icons.min.css">
<style>:root{${themeCssVars(theme)}}
${baseCss()}</style></head>
<body><div class="app">
<div class="topbar"><div class="brand"><span class="dot"><i class="ti ti-shield-half"></i></span><span>${esc(cfg.appName)}${cfg.org ? `<span class="sub"> · ${esc(cfg.org)}</span>` : ''}</span></div><span class="user"><i class="ti ti-user-circle"></i> ${esc(cfg.user || '用户')}</span></div>
<div class="body"><nav class="nav">${navHtml}</nav><main class="content">${cfg.contentHtml}</main></div>
</div></body></html>`;
}
