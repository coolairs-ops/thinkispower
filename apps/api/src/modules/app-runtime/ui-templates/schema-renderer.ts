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
  let kpiRun: { block: Block; id: string }[] = [];
  const flushKpis = () => {
    if (!kpiRun.length) return;
    const inner = kpiRun.map((k) => renderBlock(k.block, k.id)).join('');
    out.push(`<div class="grid" style="grid-template-columns:repeat(${kpiRun.length},1fr);margin-bottom:16px">${inner}</div>`);
    kpiRun = [];
  };
  page.blocks.forEach((block, i) => {
    const id = `b${pageIdx}-${i}`;
    if (block.type === 'kpi') { kpiRun.push({ block, id }); return; }
    flushKpis();
    out.push(`<div style="margin-bottom:16px">${renderBlock(block, id)}</div>`);
  });
  flushKpis();
  return out.join('');
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
  const content = blockRuntime() + sections + (pages.length > 1 ? switchScript() : '');
  return renderShell({
    appName: schema.appName,
    org: schema.org,
    themeId: schema.themeId,
    user: schema.user,
    nav,
    contentHtml: content,
  });
}
