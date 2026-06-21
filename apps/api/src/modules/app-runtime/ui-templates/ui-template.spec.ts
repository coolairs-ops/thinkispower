import { getTheme, themeCssVars, THEMES, listThemes } from './theme-tokens';
import { renderShell, esc } from './app-shell.template';
import { renderDashboard } from './dashboard.template';
import { renderApp, defaultFrontNav } from './app-template';

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
});
