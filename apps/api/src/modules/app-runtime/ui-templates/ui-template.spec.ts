import { getTheme, themeCssVars, THEMES, listThemes } from './theme-tokens';
import { renderShell, esc } from './app-shell.template';
import { renderDashboard } from './dashboard.template';
import { renderApp, defaultFrontNav } from './app-template';
import { renderKnowledge } from './knowledge.template';
import { renderQa } from './qa.template';
import { renderAdminApp, buildAdminNav, deriveAdminCaps } from './admin-template';

describe('内置模板渲染（套模板填数据，替代 DeepSeek 即兴）', () => {
  it('主题 token：6 套齐全，CSS vars 含主色，未知 id 回退政务蓝', () => {
    expect(listThemes()).toHaveLength(6);
    const css = themeCssVars(THEMES['gov-blue']);
    expect(css).toContain('--t-primary:#185FA5');
    expect(css).toContain('--t-header-bg:#185FA5');
    expect(getTheme('不存在').id).toBe('gov-blue');
    expect(getTheme('dark-ops').dark).toBe(true);
  });

  it('深色皮肤用深底语义色（深底浅字）', () => {
    expect(themeCssVars(THEMES['dark-ops'])).toContain('--t-danger-bg:#501313');
    expect(themeCssVars(THEMES['gov-blue'])).toContain('--t-danger-bg:#FCEBEB');
  });

  it('外壳：整页 HTML + 主题 var + 顶栏 + 侧栏，按 themeId 换皮', () => {
    const html = renderShell({ appName: '风控平台', org: '某单位', themeId: 'tech-purple', user: '王某', nav: [{ key: 'dashboard', label: '工作台', icon: 'layout-dashboard', active: true }], contentHtml: '<p>hi</p>' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('--t-header-bg:#3C3489'); // 科技紫蓝皮肤
    expect(html).toContain('class="nav"');
    expect(html).toContain('ti-layout-dashboard');
    expect(html).toContain('工作台');
    expect(html).toContain('<p>hi</p>');
  });

  it('外壳：填槽文本转义，防注入', () => {
    expect(esc('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
    const html = renderShell({ appName: '<img src=x onerror=1>', nav: [], contentHtml: '' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('工作台页型：KPI 槽 + 主列表 + appData 取数脚本', () => {
    const c = renderDashboard({
      title: '工作台',
      primaryResource: 'company',
      kpis: [{ label: '在监对象', resource: 'company' }, { label: '高风险', static: 0, tone: 'danger' }],
      columns: [{ key: 'name', label: '名称' }, { key: 'grade', label: '分级' }],
    });
    expect(c).toContain('id="kpi-0"');
    expect(c).toContain('var(--t-danger-text)'); // 高风险 KPI 用语义色
    expect(c).toContain('id="dash-rows"');
    expect(c).toContain('"primaryResource":"company"'); // 资源填进固定槽
    expect(c).toContain('window.appData.list'); // 主列表实时取数
    expect(c).toContain('在监对象');
  });

  it('装配器：默认前台侧栏=工作台/知识库/智能问答（用户敲定，无对象列表/画像/待确认）', () => {
    const nav = defaultFrontNav();
    expect(nav.map((n) => n.label)).toEqual(['工作台', '知识库', '智能问答']);
    const html = renderApp({ appName: '评分平台', themeId: 'gov-blue', dashboard: { title: '工作台', primaryResource: 'item', kpis: [], columns: [{ key: 'name', label: '名称' }] } });
    expect(html).toContain('知识库');
    expect(html).toContain('智能问答');
    expect(html).not.toContain('对象列表');
    expect(html).not.toContain('评分画像');
  });

  it('前台多模块 SPA：工作台/知识库/问答三段 + 导航切换脚本', () => {
    const html = renderApp({ appName: 'X', dashboard: { title: '工作台', primaryResource: 'item', kpis: [], columns: [{ key: 'name', label: '名称' }] } });
    expect(html).toContain('data-page="dashboard"');
    expect(html).toContain('data-page="knowledge"');
    expect(html).toContain('data-page="qa"');
    expect(html).toContain("s.getAttribute('data-page')"); // 客户端切 section
    expect(html).toContain('可溯源知识库'); // 知识库页型内容
    expect(html).toContain('智能问答'); // 问答页型内容
  });

  it('页型：知识库带证据链概念，问答带聊天结构', () => {
    expect(renderKnowledge()).toContain('证据链完整度');
    expect(renderKnowledge()).toContain('var(--t-warning-bg)'); // 原文引用用语义色
    expect(renderQa()).toContain('var(--t-info-bg)'); // 用户气泡
    expect(renderQa()).toContain('ti-send');
  });

  it('后台：通用栏恒在 + 业务列表（appData），删掉了监控/代码生成', () => {
    const labels = buildAdminNav('data', { rules: true, knowledge: true }).map((n) => n.label);
    expect(labels).toEqual(['业务数据', '规则配置', '知识库管理', '用户管理', '角色权限', '组织部门', '操作审计', '系统设置']);
    expect(labels).not.toContain('系统监控');
    expect(labels).not.toContain('代码生成');
    const html = renderAdminApp({ appName: '监管平台', themeId: 'gov-blue', resource: 'company', resourceLabel: '企业', columns: [{ key: 'name', label: '名称' }, { key: 'level', label: '分级', badge: true }] });
    expect(html).toContain('管理后台');
    expect(html).toContain('角色权限');
    expect(html).toContain('id="adm-rows"');
    expect(html).toContain('window.appData.list'); // 业务列表实时取数
  });

  it('后台侧栏按能力出：无能力 → 规则配置/知识库管理不出，通用栏恒在', () => {
    const labels = buildAdminNav('data', {}).map((n) => n.label);
    expect(labels).toEqual(['业务数据', '用户管理', '角色权限', '组织部门', '操作审计', '系统设置']);
    expect(labels).not.toContain('规则配置'); // 不再无条件固化
    expect(labels).not.toContain('知识库管理');
  });

  it('后台侧栏按能力出：仅启用规则 → 出规则配置，不出知识库', () => {
    const labels = buildAdminNav('data', { rules: true }).map((n) => n.label);
    expect(labels).toContain('规则配置');
    expect(labels).not.toContain('知识库管理');
  });

  it('deriveAdminCaps：业务规则非空→rules；功能/页面提知识库→knowledge', () => {
    expect(deriveAdminCaps({ businessRules: [{ name: '审批' }] }, null)).toEqual({ rules: true, knowledge: false });
    expect(deriveAdminCaps(null, { features: ['知识库检索'], pages: [] })).toEqual({ rules: false, knowledge: true });
    expect(deriveAdminCaps(null, { features: ['登录'], pages: [{ name: '工作台' }] })).toEqual({ rules: false, knowledge: false });
    expect(deriveAdminCaps({ businessRules: [] }, {})).toEqual({ rules: false, knowledge: false });
  });
});
