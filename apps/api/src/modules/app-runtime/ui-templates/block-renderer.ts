import { esc } from './app-shell.template';
import { Block } from './page-schema.types';

/**
 * 块渲染器（Schema 驱动 S1）：单个 Block → HTML 片段（含自带的 appData 绑定脚本）。
 * 收编现有 dashboard/admin 的"表格 + KPI + appData 实时取数 + 徽章"为块级能力；
 * 读路径(kpi/table/detail)绑 appData.list/get，写路径(form/generate)绑 appData.create。
 * 纯函数、确定性、零 LLM。复用 app-shell 的基础 CSS 类（.card/.kpi/.badge/table/.btn）。
 */

/** 每页注入一次的共享运行时：文本转义 + 徽章单元格（块脚本复用，避免每块重复几百字节）。 */
export function blockRuntime(): string {
  return `<script>window.__tpl=window.__tpl||(function(){`
    + `function txt(v){return v==null?'':String(v).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}`
    + `function cell(v,b){if(b&&v!=null){var m={'D':'b-d','C':'b-c','B':'b-b','A':'b-a'},cls=m[String(v)]||'';return '<td>'+(cls?'<span class="badge '+cls+'">'+txt(v)+'</span>':txt(v))+'</td>';}return '<td>'+txt(v)+'</td>';}`
    + `return{txt:txt,cell:cell};})();</script>`;
}

/** 把块运行配置序列化进脚本（防 </script> 截断：转义 `<`）。 */
const jcfg = (o: unknown): string => JSON.stringify(o).replace(/</g, '\\u003c');

/** 单个块 → HTML。id 由渲染器按「页下标-块下标」传入，保证页内 DOM id 唯一。 */
export function renderBlock(block: Block, id: string): string {
  switch (block.type) {
    case 'kpi': return kpiBlock(block, id);
    case 'table': return tableBlock(block, id);
    case 'detail': return detailBlock(block, id);
    case 'form': return formBlock(block, id);
    case 'generate': return generateBlock(block, id);
    case 'qa': return qaBlock(block, id);
    case 'richtext': return richtextBlock(block);
    default: return '';
  }
}

function kpiBlock(b: Extract<Block, { type: 'kpi' }>, id: string): string {
  const C = jcfg({ resource: b.bind.resource });
  return `<div class="kpi"><div class="l">${esc(b.props.label)}</div><div class="v" id="${id}-v">—</div></div>`
    + `<script>(function(){var C=${C};if(!window.appData)return;window.appData.list(C.resource,{pageSize:1}).then(function(r){var e=document.getElementById('${id}-v');if(e)e.textContent=(r&&r.total!=null?r.total:0);}).catch(function(){});})();</script>`;
}

function tableBlock(b: Extract<Block, { type: 'table' }>, id: string): string {
  const fields = b.bind.fields?.length ? b.bind.fields : ['id'];
  const badges = b.props?.badges ?? [];
  const actions = b.props?.rowActions ?? [];
  const lbl = (f: string) => b.bind.fieldLabels?.[f] || f; // 字段中文显示名(回退技术名)
  const C = jcfg({ resource: b.bind.resource, columns: fields, badges: fields.map((f) => badges.includes(f)), actions });
  const colspan = fields.length + (actions.length ? 1 : 0);
  const thead = fields.map((f) => `<th>${esc(lbl(f))}</th>`).join('') + (actions.length ? `<th style="width:90px">操作</th>` : '');
  const title = b.props?.title ? `<div class="h1">${esc(b.props.title)}</div>` : '';
  const toolbar = b.props?.searchable
    ? `<div style="display:flex;justify-content:space-between;margin-bottom:12px"><div style="display:flex;gap:8px"><input placeholder="搜索" style="height:32px;border:.5px solid var(--t-card-border);border-radius:8px;padding:0 10px;background:var(--t-card);color:var(--t-text);width:200px"/><button class="btn" style="height:32px"><i class="ti ti-search"></i> 查询</button></div></div>`
    : '';
  return title + `<div class="card">${toolbar}<table><thead><tr>${thead}</tr></thead><tbody id="${id}-rows"><tr><td colspan="${colspan}" class="muted">加载中…</td></tr></tbody></table></div>`
    + `<script>(function(){var C=${C},T=window.__tpl;if(!window.appData||!T)return;window.appData.list(C.resource,{pageSize:50}).then(function(r){var rows=(r&&r.items)||[],tb=document.getElementById('${id}-rows');if(!tb)return;tb.innerHTML=rows.length?rows.map(function(row){return '<tr>'+C.columns.map(function(k,i){return T.cell(row[k],C.badges[i]);}).join('')+(C.actions.length?'<td>'+C.actions.map(function(a){return '<span style="color:var(--t-primary);cursor:pointer;margin-right:8px">'+T.txt(a)+'</span>';}).join('')+'</td>':'')+'</tr>';}).join(''):'<tr><td colspan="${colspan}" class="muted">暂无数据</td></tr>';}).catch(function(){});})();</script>`;
}

function detailBlock(b: Extract<Block, { type: 'detail' }>, id: string): string {
  const fields = b.bind.fields?.length ? b.bind.fields : ['id'];
  const C = jcfg({ resource: b.bind.resource, fields, labels: fields.map((f) => b.bind.fieldLabels?.[f] || f) });
  const title = b.props?.title ? `<div class="h1">${esc(b.props.title)}</div>` : '';
  return title + `<div class="card"><table id="${id}-d"><tbody><tr><td class="muted">加载中…</td></tr></tbody></table></div>`
    + `<script>(function(){var C=${C},T=window.__tpl;if(!window.appData||!T)return;window.appData.list(C.resource,{pageSize:1}).then(function(r){var row=(r&&r.items&&r.items[0])||{},tb=document.querySelector('#${id}-d tbody');if(!tb)return;tb.innerHTML=C.fields.map(function(f,i){return '<tr><th style="width:140px">'+T.txt(C.labels[i]||f)+'</th><td>'+T.txt(row[f])+'</td></tr>';}).join('');}).catch(function(){});})();</script>`;
}

function formBlock(b: Extract<Block, { type: 'form' }>, id: string): string {
  const fields = b.bind.fields?.length ? b.bind.fields : ['name'];
  const C = jcfg({ resource: b.bind.resource, fields });
  const title = b.props?.title ? `<div class="h1">${esc(b.props.title)}</div>` : '';
  const inputs = fields.map((f, i) =>
    `<div style="margin-bottom:12px"><div class="muted" style="margin-bottom:4px">${esc(b.bind.fieldLabels?.[f] || f)}</div><input id="${id}-f${i}" style="width:100%;height:34px;padding:0 10px;border:.5px solid var(--t-card-border);border-radius:8px;background:var(--t-card);color:var(--t-text)"/></div>`,
  ).join('');
  const submit = esc(b.props?.submitLabel ?? '提交');
  return title + `<div class="card" style="max-width:560px">${inputs}<button class="btn" id="${id}-submit">${submit}</button></div>`
    + `<script>(function(){var C=${C},btn=document.getElementById('${id}-submit');if(!btn)return;btn.addEventListener('click',function(){if(!window.appData)return;var d={};C.fields.forEach(function(f,i){var el=document.getElementById('${id}-f'+i);d[f]=el?el.value:'';});btn.disabled=true;window.appData.create(C.resource,d).then(function(){btn.textContent='已提交';}).catch(function(){btn.disabled=false;btn.textContent='提交失败，重试';});});})();</script>`;
}

function generateBlock(b: Extract<Block, { type: 'generate' }>, id: string): string {
  const field = b.props?.inputField ?? (b.bind.fields?.[0] ?? 'input');
  const C = jcfg({ resource: b.bind.resource, field });
  const title = b.props?.title ? `<div class="h1">${esc(b.props.title)}</div>` : '';
  const label = esc(b.props?.inputLabel ?? '输入');
  const button = esc(b.props?.button ?? '一键生成');
  return title + `<div class="card"><div class="muted" style="margin-bottom:6px">${label}</div>`
    + `<textarea id="${id}-in" style="width:100%;min-height:110px;padding:10px;border:.5px solid var(--t-card-border);border-radius:8px;background:var(--t-card);color:var(--t-text)"></textarea>`
    + `<div style="margin-top:12px"><button class="btn" id="${id}-gen"><i class="ti ti-wand"></i> ${button}</button></div>`
    + `<div id="${id}-out" class="card" style="margin-top:14px;display:none"></div></div>`
    + `<script>(function(){var C=${C},btn=document.getElementById('${id}-gen');if(!btn)return;btn.addEventListener('click',function(){if(!window.appData)return;var inp=document.getElementById('${id}-in'),out=document.getElementById('${id}-out'),d={};d[C.field]=inp?inp.value:'';btn.disabled=true;window.appData.create(C.resource,d).then(function(){btn.disabled=false;if(out){out.style.display='block';out.textContent='已生成并保存。';}}).catch(function(){btn.disabled=false;if(out){out.style.display='block';out.textContent='生成失败，请重试。';}});});})();</script>`;
}

/**
 * 第 7 块（ADR-0008 D6 生成器词汇生长）：问答/聊天交互界面。
 * 自动回复：发送 → appData.ask(q) 渲染答案；未知问题：点「上报」→ appData.create(resource,{question,status:'escalated'}) 落库转人工。
 * 知识库为空时优雅降级（提示未找到、引导上报），不报错。
 */
function qaBlock(b: Extract<Block, { type: 'qa' }>, id: string): string {
  const C = jcfg({ resource: b.bind.resource });
  const title = b.props?.title ? `<div class="h1">${esc(b.props.title)}</div>` : '';
  const placeholder = esc(b.props?.placeholder ?? '请输入你的问题…');
  const escLabel = esc(b.props?.escalateLabel ?? '上报人工');
  return title + `<div class="card" style="display:flex;flex-direction:column;height:420px">`
    + `<div id="${id}-log" style="flex:1;overflow-y:auto;padding:4px 2px;display:flex;flex-direction:column;gap:10px"></div>`
    + `<div style="display:flex;gap:8px;margin-top:10px">`
    + `<input id="${id}-q" placeholder="${placeholder}" style="flex:1;height:38px;padding:0 12px;border:.5px solid var(--t-card-border);border-radius:20px;background:var(--t-card);color:var(--t-text)"/>`
    + `<button class="btn" id="${id}-send">发送</button>`
    + `<button class="btn" id="${id}-esc" style="background:var(--t-card);color:var(--t-text);border:.5px solid var(--t-card-border)">${escLabel}</button>`
    + `</div></div>`
    + `<script>(function(){var C=${C};var log=document.getElementById('${id}-log'),q=document.getElementById('${id}-q'),send=document.getElementById('${id}-send'),escb=document.getElementById('${id}-esc');if(!log||!q)return;`
    + `function bubble(t,who){var d=document.createElement('div');d.style.cssText='max-width:78%;padding:8px 12px;border-radius:12px;font-size:13px;'+(who==='me'?'align-self:flex-end;background:var(--t-primary);color:#fff':'align-self:flex-start;background:var(--t-card);border:.5px solid var(--t-card-border);color:var(--t-text)');d.textContent=t;log.appendChild(d);log.scrollTop=log.scrollHeight;}`
    + `function ask(){var text=(q.value||'').trim();if(!text||!window.appData)return;bubble(text,'me');q.value='';var p=window.appData.ask?window.appData.ask(text):Promise.resolve(null);Promise.resolve(p).then(function(r){var a=r&&(r.answer||r.text||r.reply);bubble(a?a:'未在知识库找到答案，可点「${escLabel}」上报人工。','bot');}).catch(function(){bubble('暂时无法回答，请稍后重试或上报。','bot');});}`
    + `send&&send.addEventListener('click',ask);q.addEventListener('keydown',function(e){if(e.key==='Enter')ask();});`
    + `escb&&escb.addEventListener('click',function(){var text=(q.value||'').trim()||'用户未知问题';if(!window.appData||!window.appData.create)return;window.appData.create(C.resource,{question:text,status:'escalated'}).then(function(){bubble('已上报人工处理，我们会尽快回复。','bot');}).catch(function(){bubble('上报失败，请重试。','bot');});});`
    + `})();</script>`;
}

function richtextBlock(b: Extract<Block, { type: 'richtext' }>): string {
  // richtext 承载格式化 HTML（平台/编辑产出）；去 script/style/iframe 与内联事件，防注入。
  const safe = String(b.props.html ?? '')
    .replace(/<\/?(script|style|iframe)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  return `<div class="card">${safe}</div>`;
}
