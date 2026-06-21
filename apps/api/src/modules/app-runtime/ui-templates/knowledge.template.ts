/**
 * 知识库页型（前台模块）：可溯源知识库的浏览/上传入口。只读主题 var(--t-*)，主题自动套。
 * 结构就位；活数据(原件/证据/事实)接入随后（需 app 级 knowledge 端点）。
 */
export function renderKnowledge(): string {
  return `<div class="h1">可溯源知识库</div>
<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
<div><div style="font-weight:500">原件与证据</div><div class="muted" style="font-size:13px">上传材料 → AI 提取候选 → 机器核对原文 → 人工确认。每个进评分的数据都可回溯到原件原文。</div></div>
<button class="btn"><i class="ti ti-upload"></i> 上传原件</button></div></div>
<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
<div class="card"><div style="font-weight:500;margin-bottom:8px">待确认事实</div>
<div style="border-left:2px solid var(--t-info-text);padding-left:12px;font-size:13px">
<div style="margin-bottom:10px"><div>不合格批次数 = <b>13</b></div><div class="muted" style="background:var(--t-warning-bg);color:var(--t-warning-text);padding:3px 7px;border-radius:6px;margin-top:3px;display:inline-block">“累计被通报不合格药品13批次”</div></div>
<div><div>检查次数 = <b>3</b></div><div class="muted" style="background:var(--t-warning-bg);color:var(--t-warning-text);padding:3px 7px;border-radius:6px;margin-top:3px;display:inline-block">“累计接受3次检查”</div></div></div>
<div style="margin-top:10px"><button class="btn" style="height:30px;font-size:12px">确认采纳</button></div></div>
<div class="card"><div style="font-weight:500;margin-bottom:8px">证据链完整度</div>
<div style="font-size:13px" class="muted">每个结论顺链回指：评分值 → 事实 → 原文片段 → 原件（哈希校验未篡改）。缺证据的事项标“待核实”，绝不自动下结论。</div>
<div style="margin-top:10px"><span class="badge b-a">已确认 2</span> <span class="badge b-c" style="margin-left:6px">待确认 0</span></div></div>
</div>`;
}
