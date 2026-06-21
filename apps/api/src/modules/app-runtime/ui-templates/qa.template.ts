/**
 * 智能问答页型（前台模块，活数据）：调 appData.ask(q) 真回答（基于本项目数据模型/规则）。
 * 只读主题 var(--t-*)，主题自动套。无 appData 时静默。
 */
export function renderQa(): string {
  return `<div class="h1">智能问答</div>
<div class="card" style="display:flex;flex-direction:column;gap:12px;min-height:340px">
<div id="qa-log" style="display:flex;flex-direction:column;gap:12px;flex:1">
<div style="display:flex;gap:9px"><div style="width:28px;height:28px;flex-shrink:0;border-radius:50%;background:var(--t-nav-bg);display:flex;align-items:center;justify-content:center;color:var(--t-primary)"><i class="ti ti-robot"></i></div>
<div style="background:var(--t-nav-bg);padding:11px 13px;border-radius:12px;font-size:13px;line-height:1.7">我基于本系统的数据模型和规则回答，结论可溯源、默认待人工确认。<div class="muted" style="margin-top:7px;font-size:12px"><i class="ti ti-link"></i> 问问对象的风险、历史或处置建议</div></div></div>
</div>
<div style="display:flex;gap:8px"><input id="qa-in" placeholder="输入问题…" style="flex:1;height:38px;border:.5px solid var(--t-card-border);border-radius:8px;padding:0 12px;background:var(--t-card);color:var(--t-text)"/><button id="qa-send" class="btn"><i class="ti ti-send"></i> 发送</button></div>
</div>
<script>(function(){var inp=document.getElementById('qa-in'),btn=document.getElementById('qa-send'),log=document.getElementById('qa-log');if(!inp||!btn||!log)return;
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
function bubble(side,html){var d=document.createElement('div');d.style.display='flex';d.style.justifyContent=side==='u'?'flex-end':'flex-start';d.innerHTML=side==='u'?'<div style="max-width:78%;background:var(--t-info-bg);color:var(--t-info-text);padding:9px 12px;border-radius:12px;font-size:13px">'+html+'</div>':'<div style="background:var(--t-nav-bg);padding:11px 13px;border-radius:12px;font-size:13px;line-height:1.7">'+html+'</div>';log.appendChild(d);}
function send(){var qs=(inp.value||'').trim();if(!qs||!window.appData||!window.appData.ask)return;inp.value='';bubble('u',esc(qs));var t=document.createElement('div');t.className='muted';t.style.fontSize='13px';t.textContent='思考中…';log.appendChild(t);window.appData.ask(qs).then(function(a){t.remove();bubble('a',esc(a||'暂时无法回答')+'<div class="muted" style="margin-top:6px;font-size:12px">结论可溯源、待人工确认</div>');});}
btn.addEventListener('click',send);inp.addEventListener('keydown',function(e){if(e.key==='Enter')send();});})();</script>`;
}
