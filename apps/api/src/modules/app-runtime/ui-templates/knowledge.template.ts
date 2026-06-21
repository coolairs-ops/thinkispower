/**
 * 知识库页型（前台模块，活数据）：调 appData.knowledge() 显真原件/证据/事实 + 证据链完整度。
 * 只读主题 var(--t-*)，主题自动套。无 appData 时静默（不崩）。
 */
export function renderKnowledge(): string {
  return `<div class="h1">可溯源知识库</div>
<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
<div><div style="font-weight:500">原件与证据</div><div class="muted" style="font-size:13px">每个进评分的数据都可回溯到原件原文；缺证据的标“待核实”，绝不自动下结论。</div></div>
<div class="muted" style="font-size:13px">证据链完整度 <b id="kb-comp">—</b></div></div></div>
<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
<div class="card"><div style="font-weight:500;margin-bottom:8px">待确认事实 <span class="muted" id="kb-cand-n"></span></div><div id="kb-cand" class="muted" style="font-size:13px">加载中…</div></div>
<div class="card"><div style="font-weight:500;margin-bottom:8px">已采纳事实 <span class="muted" id="kb-conf-n"></span></div><div id="kb-conf" class="muted" style="font-size:13px">加载中…</div></div>
</div>
<script>(function(){if(!window.appData||!window.appData.knowledge)return;
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
window.appData.knowledge().then(function(kb){
var facts=(kb&&kb.facts)||[],ev={};((kb&&kb.evidences)||[]).forEach(function(e){ev[e.evidence_id]=e;});
function q(f){var e=ev[(f.evidence_refs||[])[0]];return e?'<div class="muted" style="background:var(--t-warning-bg);color:var(--t-warning-text);padding:3px 7px;border-radius:6px;margin-top:3px;display:inline-block">“'+esc(e.quote)+'”</div>':'';}
function row(f){return '<div style="margin-bottom:10px"><div>'+esc(f.name)+' = <b>'+esc(f.value)+'</b></div>'+q(f)+'</div>';}
var cand=facts.filter(function(f){return f.status==='candidate';}),conf=facts.filter(function(f){return f.status==='confirmed';});
document.getElementById('kb-cand').innerHTML=cand.length?cand.map(row).join(''):'暂无待确认';
document.getElementById('kb-conf').innerHTML=conf.length?conf.map(row).join(''):'暂无已采纳';
document.getElementById('kb-cand-n').textContent=cand.length?('· '+cand.length):'';
document.getElementById('kb-conf-n').textContent=conf.length?('· '+conf.length):'';
var need=facts.filter(function(f){return f.status!=='rejected';}).length;
document.getElementById('kb-comp').textContent=need?Math.round(conf.length/need*100)+'%':'—';
});})();</script>`;
}
