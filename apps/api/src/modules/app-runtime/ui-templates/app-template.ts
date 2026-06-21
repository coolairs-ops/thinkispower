import { renderShell, NavItem } from './app-shell.template';
import { renderDashboard, DashboardConfig } from './dashboard.template';

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
}

/** 前台默认侧栏（用户敲定：工作台 + 知识库 + 智能问答）。 */
export function defaultFrontNav(active = 'dashboard'): NavItem[] {
  return [
    { key: 'dashboard', label: '工作台', icon: 'layout-dashboard', active: active === 'dashboard' },
    { key: 'knowledge', label: '知识库', icon: 'books', active: active === 'knowledge' },
    { key: 'qa', label: '智能问答', icon: 'message-chatbot', active: active === 'qa' },
  ];
}

export function renderApp(cfg: AppTemplateConfig): string {
  return renderShell({
    appName: cfg.appName,
    org: cfg.org,
    themeId: cfg.themeId,
    user: cfg.user,
    nav: cfg.nav ?? defaultFrontNav('dashboard'),
    contentHtml: renderDashboard(cfg.dashboard),
  });
}
