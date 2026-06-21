import { esc } from './app-shell.template';

export interface KpiSlot {
  label: string;
  /** 取该资源的总数当值（appData.list 的 total）；不填则用 static。 */
  resource?: string;
  static?: string | number;
  tone?: 'danger' | 'warning' | 'info' | 'success';
}
export interface DashboardConfig {
  title: string;
  /** 主列表资源名（appData.list 拉取） */
  primaryResource: string;
  kpis: KpiSlot[];
  columns: { key: string; label: string }[];
}

/**
 * 工作台页型（确定性出内容 HTML）：KPI 卡 + 主列表。
 * 数据槽位由内联脚本运行时经 window.appData 填充（serve 层注入 appData）；无 appData 时显占位、不崩。
 * DeepSeek 不参与——这页的结构/样式由模板钉死，只把"这个项目的资源/列"填进固定槽。
 */
export function renderDashboard(cfg: DashboardConfig): string {
  const kpiHtml = cfg.kpis.map((k, i) => {
    const toneCls = k.tone ? ` style="color:var(--t-${k.tone}-text)"` : '';
    const init = k.static != null ? esc(k.static) : '—';
    return `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="v" id="kpi-${i}"${toneCls}>${init}</div></div>`;
  }).join('');

  const thead = cfg.columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const cfgJson = JSON.stringify({
    primaryResource: cfg.primaryResource,
    columns: cfg.columns.map((c) => c.key),
    kpis: cfg.kpis.map((k) => k.resource ?? null),
  }).replace(/</g, '\\u003c');

  return `<div class="h1">${esc(cfg.title)}</div>
<div class="grid" style="grid-template-columns:repeat(${Math.max(1, cfg.kpis.length)},1fr);margin-bottom:16px">${kpiHtml}</div>
<div class="card"><table><thead><tr>${thead}</tr></thead><tbody id="dash-rows"><tr><td colspan="${cfg.columns.length}" class="muted">加载中…</td></tr></tbody></table></div>
<script>(function(){var C=${cfgJson};
function cell(v){return '<td>'+(v==null?'':String(v).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}))+'</td>';}
if(!window.appData){return;}
C.kpis.forEach(function(res,i){if(!res)return;window.appData.list(res,{pageSize:1}).then(function(r){var e=document.getElementById('kpi-'+i);if(e)e.textContent=(r&&r.total!=null?r.total:0);}).catch(function(){});});
window.appData.list(C.primaryResource,{pageSize:50}).then(function(r){var rows=(r&&r.items)||[];var tb=document.getElementById('dash-rows');if(!tb)return;if(!rows.length){tb.innerHTML='<tr><td colspan="'+C.columns.length+'" class="muted">暂无数据</td></tr>';return;}tb.innerHTML=rows.map(function(row){return '<tr>'+C.columns.map(function(k){return cell(row[k]);}).join('')+'</tr>';}).join('');}).catch(function(){var tb=document.getElementById('dash-rows');if(tb)tb.innerHTML='<tr><td colspan="'+C.columns.length+'" class="muted">数据加载失败</td></tr>';});
})();</script>`;
}
