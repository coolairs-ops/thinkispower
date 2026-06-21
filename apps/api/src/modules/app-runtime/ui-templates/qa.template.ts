/**
 * 智能问答页型（前台模块）：基于对象数据/证据链回答。只读主题 var(--t-*)，主题自动套。
 * 聊天结构就位；接 LLM 问答端点随后。
 */
export function renderQa(): string {
  return `<div class="h1">智能问答</div>
<div class="card" style="display:flex;flex-direction:column;gap:12px;min-height:340px">
<div style="display:flex;justify-content:flex-end"><div style="max-width:78%;background:var(--t-info-bg);color:var(--t-info-text);padding:9px 12px;border-radius:12px;font-size:13px">这个对象为什么是这个评级？</div></div>
<div style="display:flex;gap:9px"><div style="width:28px;height:28px;flex-shrink:0;border-radius:50%;background:var(--t-nav-bg);display:flex;align-items:center;justify-content:center;color:var(--t-primary)"><i class="ti ti-robot"></i></div>
<div style="background:var(--t-nav-bg);padding:11px 13px;border-radius:12px;font-size:13px;line-height:1.7">我基于该对象的指标、历史记录和证据链回答，结论可溯源、默认待人工确认。
<div class="muted" style="margin-top:7px;font-size:12px"><i class="ti ti-link"></i> 接入项目数据后，每条回答都会引用真实证据并标注完整度</div></div></div>
<div style="margin-top:auto;display:flex;gap:8px"><input placeholder="问问这个对象的风险、历史或处置建议…" style="flex:1;height:38px;border:.5px solid var(--t-card-border);border-radius:8px;padding:0 12px;background:var(--t-card);color:var(--t-text)"/><button class="btn"><i class="ti ti-send"></i> 发送</button></div>
</div>`;
}
