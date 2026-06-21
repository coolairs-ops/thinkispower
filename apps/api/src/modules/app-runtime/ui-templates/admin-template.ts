import { renderShell, NavItem, esc } from './app-shell.template';

/** 后台预置侧栏（用户敲定）：业务运营 + 权限组织 + 系统。删掉若依的系统监控/代码生成/表单构建。 */
export function defaultAdminNav(active = 'data'): NavItem[] {
  return [
    { key: 'data', label: '业务数据', icon: 'database', active: active === 'data' },
    { key: 'rules', label: '规则配置', icon: 'adjustments', active: active === 'rules' },
    { key: 'knowledge', label: '知识库管理', icon: 'books', active: active === 'knowledge' },
    { key: 'users', label: '用户管理', icon: 'users', active: active === 'users' },
    { key: 'roles', label: '角色权限', icon: 'lock-access', active: active === 'roles' },
    { key: 'depts', label: '组织部门', icon: 'sitemap', active: active === 'depts' },
    { key: 'audit', label: '操作审计', icon: 'history', active: active === 'audit' },
    { key: 'settings', label: '系统设置', icon: 'settings', active: active === 'settings' },
  ];
}

export interface AdminConfig {
  appName: string;
  org?: string;
  themeId?: string;
  user?: string;
  resource: string;
  resourceLabel: string;
  columns: { key: string; label: string; badge?: boolean }[];
}

/** 后台业务数据列表（toolbar + appData 实时表格 + 行操作）。 */
function renderAdminList(cfg: AdminConfig): string {
  const thead = cfg.columns.map((c) => `<th>${esc(c.label)}</th>`).join('') + '<th style="width:80px">操作</th>';
  const j = JSON.stringify({ resource: cfg.resource, columns: cfg.columns.map((c) => c.key), badges: cfg.columns.map((c) => !!c.badge) }).replace(/</g, '\\u003c');
  return `<div class="h1">${esc(cfg.resourceLabel)}管理</div>
<div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:12px">
<div style="display:flex;gap:8px"><input placeholder="搜索${esc(cfg.resourceLabel)}" style="height:32px;border:.5px solid var(--t-card-border);border-radius:8px;padding:0 10px;background:var(--t-card);color:var(--t-text);width:200px"/><button class="btn" style="height:32px"><i class="ti ti-search"></i> 查询</button></div>
<button class="btn" style="height:32px"><i class="ti ti-plus"></i> 新增</button></div>
<table><thead><tr>${thead}</tr></thead><tbody id="adm-rows"><tr><td colspan="${cfg.columns.length + 1}" class="muted">加载中…</td></tr></tbody></table></div>
<script>(function(){var C=${j};
function txt(v){return v==null?'':String(v).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
function cell(v,b){if(b&&v!=null){var m={'D':'b-d','C':'b-c','B':'b-b','A':'b-a'},cls=m[String(v)]||'';return '<td>'+(cls?'<span class="badge '+cls+'">'+txt(v)+'</span>':txt(v))+'</td>';}return '<td>'+txt(v)+'</td>';}
if(!window.appData)return;
window.appData.list(C.resource,{pageSize:50}).then(function(r){var rows=(r&&r.items)||[],tb=document.getElementById('adm-rows');if(!tb)return;tb.innerHTML=rows.length?rows.map(function(row){return '<tr>'+C.columns.map(function(k,i){return cell(row[k],C.badges[i]);}).join('')+'<td><span style="color:var(--t-primary);cursor:pointer">编辑</span></td></tr>';}).join(''):'<tr><td colspan="'+(C.columns.length+1)+'" class="muted">暂无数据</td></tr>';}).catch(function(){});
})();</script>`;
}

/** 后台管理控制台：管理侧栏 + 业务数据列表。与前台同主题皮肤、不同导航与职责。 */
export function renderAdminApp(cfg: AdminConfig): string {
  return renderShell({
    appName: `${cfg.appName} · 管理后台`,
    org: cfg.org,
    themeId: cfg.themeId,
    user: cfg.user,
    nav: defaultAdminNav('data'),
    contentHtml: renderAdminList(cfg),
  });
}
