import { renderShell, NavItem, esc } from './app-shell.template';
import { AppSchema, Page, Block } from './page-schema.types';
import { renderBlock, blockRuntime } from './block-renderer';

/**
 * 确定性 Schema 渲染器（Schema 驱动 S1）：AppSchema → 整页 HTML，零 LLM。
 *
 * 收编现有工作台/后台渲染为「块渲染器」：复用 renderShell 外壳 + 主题 token，
 * 多页走 SPA 切换（同 app-template 的 display 切换）。读路径(kpi/table/detail)绑
 * appData.list，写路径(form/generate)绑 appData.create。S1 只证闭环，不接生产路径。
 */

/** 一页内容：连续 kpi 块并入一行 grid（同 dashboard 的 KPI 行），其余块按序渲染。 */
function renderPage(page: Page, pageIdx: number): string {
  const out: string[] = [];
  // 每块挂 data-module-key / data-element-path（批注挂载点 + L1 静态传感器的批注/覆盖率检查靠它算分）。
  // 侧栏导航不挂（避免拦截切页），与老生成器口径一致。
  let kpiRun: { block: Block; id: string; mk: string }[] = [];
  const flushKpis = () => {
    if (!kpiRun.length) return;
    const inner = kpiRun.map((k) => `<div data-module-key="${esc(k.mk)}" data-element-path="kpi">${renderBlock(k.block, k.id)}</div>`).join('');
    out.push(`<div class="grid" style="grid-template-columns:repeat(${kpiRun.length},1fr);margin-bottom:16px">${inner}</div>`);
    kpiRun = [];
  };
  page.blocks.forEach((block, i) => {
    const id = `b${pageIdx}-${i}`;
    const mk = `${page.key}-${i}`;
    if (block.type === 'kpi') { kpiRun.push({ block, id, mk }); return; }
    flushKpis();
    out.push(`<div data-module-key="${esc(mk)}" data-element-path="${esc(block.type)}" style="margin-bottom:16px">${renderBlock(block, id)}</div>`);
  });
  flushKpis();
  return out.join('');
}

/** 批注交互脚本：点击带 data-module-key 的块 → postMessage 给父页；接父页高亮/清除命令。与 demo/page 契约一致。 */
function annotationScript(): string {
  return `<style>.annotation-highlight{outline:3px solid #3b82f6;outline-offset:2px;background-color:rgba(59,130,246,.08);border-radius:4px}</style>`
    + `<script>(function(){`
    + `document.addEventListener('click',function(e){var el=e.target.closest('[data-module-key]');if(el){parent.postMessage({type:'element-click',moduleKey:el.getAttribute('data-module-key'),elementPath:el.getAttribute('data-element-path')||''},'*');}});`
    + `window.addEventListener('message',function(e){var d=e.data||{};if(d.type==='highlight-element'){document.querySelectorAll('.annotation-highlight').forEach(function(x){x.classList.remove('annotation-highlight');});var t=document.querySelector('[data-module-key="'+d.moduleKey+'"]'+(d.elementPath?'[data-element-path="'+d.elementPath+'"]':''))||document.querySelector('[data-module-key="'+d.moduleKey+'"]');if(t){t.classList.add('annotation-highlight');t.scrollIntoView({behavior:'smooth',block:'center'});}}else if(d.type==='clear-highlight'){document.querySelectorAll('.annotation-highlight').forEach(function(x){x.classList.remove('annotation-highlight');});}});`
    + `})();</script>`;
}

/** 侧栏切页脚本（href=#key ↔ section[data-page=key]，同 app-template 的 navSwitchScript）。 */
function switchScript(): string {
  return `<script>(function(){var ns=document.querySelectorAll('.nav a');ns.forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var k=(a.getAttribute('href')||'').replace('#','');document.querySelectorAll('section[data-page]').forEach(function(s){s.style.display=s.getAttribute('data-page')===k?'block':'none';});ns.forEach(function(x){x.classList.remove('active');});a.classList.add('active');});});})();</script>`;
}

export function renderSchema(schema: AppSchema): string {
  const pages = schema.pages?.length ? schema.pages : [];
  const nav: NavItem[] = pages.map((p, i) => ({
    key: p.key,
    label: p.nav?.label || p.title,
    icon: p.nav?.icon || 'square',
    active: i === 0,
  }));
  const sections = pages
    .map((p, i) => `<section data-page="${esc(p.key)}"${i === 0 ? '' : ' style="display:none"'}>${renderPage(p, i)}</section>`)
    .join('');
  const content = blockRuntime() + sections + annotationScript() + (pages.length > 1 ? switchScript() : '');
  return renderShell({
    appName: schema.appName,
    org: schema.org,
    themeId: schema.themeId,
    user: schema.user,
    nav,
    contentHtml: content,
  });
}
