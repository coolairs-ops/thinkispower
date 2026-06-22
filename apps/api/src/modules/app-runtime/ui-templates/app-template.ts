import { renderShell, NavItem } from './app-shell.template';
import { renderDashboard, DashboardConfig } from './dashboard.template';
import { renderKnowledge } from './knowledge.template';
import { renderQa } from './qa.template';

/**
 * 应用模板装配器（"套模板填数据"的入口，替代 DeepSeek 即兴出 HTML）。
 *
 * 生成 = 选主题(themeId) + 套前台外壳 + 套工作台页型 + 把这个项目的资源/列填进固定槽。
 * 产物是确定性的整页 HTML，serve 时照旧注入 appData 取真数据。第一刀只含 工作台；
 * 知识库/智能问答页型随后照此铺。
 */
export interface AppTemplateConfig {
  appName: string;
  org?: string;
  themeId?: string;
  user?: string;
  nav?: NavItem[];
  dashboard: DashboardConfig;
  /** 业务签名功能段（混合方案 C）：插在工作台之后、知识库之前，反映 planSummary 的真实功能。 */
  featureSections?: { key: string; label: string; icon: string; html: string }[];
}

/** 前台默认侧栏（用户敲定：工作台 + 知识库 + 智能问答）。 */
export function defaultFrontNav(active = 'dashboard'): NavItem[] {
  return [
    { key: 'dashboard', label: '工作台', icon: 'layout-dashboard', active: active === 'dashboard' },
    { key: 'knowledge', label: '知识库', icon: 'books', active: active === 'knowledge' },
    { key: 'qa', label: '智能问答', icon: 'message-chatbot', active: active === 'qa' },
  ];
}

/** 前台多模块 SPA：工作台/知识库/智能问答 三段，侧栏点击客户端切换（display 切换，单文件 SPA）。 */
export function renderApp(cfg: AppTemplateConfig): string {
  const feats = cfg.featureSections ?? [];
  const sections: [string, string][] = [
    ['dashboard', renderDashboard(cfg.dashboard)],
    ...feats.map((f) => [f.key, f.html] as [string, string]),
    ['knowledge', renderKnowledge()],
    ['qa', renderQa()],
  ];
  const content = sections
    .map(([k, h]) => `<section data-page="${k}"${k === 'dashboard' ? '' : ' style="display:none"'}>${h}</section>`)
    .join('') + navSwitchScript();
  // 导航：工作台 + 各功能段 + 知识库 + 问答（功能段插在工作台后，最贴业务）
  const nav: NavItem[] = cfg.nav ?? [
    { key: 'dashboard', label: '工作台', icon: 'layout-dashboard', active: true },
    ...feats.map((f) => ({ key: f.key, label: f.label, icon: f.icon })),
    { key: 'knowledge', label: '知识库', icon: 'books' },
    { key: 'qa', label: '智能问答', icon: 'message-chatbot' },
  ];
  return renderShell({
    appName: cfg.appName,
    org: cfg.org,
    themeId: cfg.themeId,
    user: cfg.user,
    nav,
    contentHtml: content,
  });
}

/** 侧栏导航 → 切 section（href="#key" 对应 section[data-page=key]）。 */
function navSwitchScript(): string {
  return `<script>(function(){var ns=document.querySelectorAll('.nav a');ns.forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var k=(a.getAttribute('href')||'').replace('#','');document.querySelectorAll('section[data-page]').forEach(function(s){s.style.display=s.getAttribute('data-page')===k?'block':'none';});ns.forEach(function(x){x.classList.remove('active');});a.classList.add('active');});});})();</script>`;
}
