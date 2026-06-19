/**
 * 分段生成的「确定性外壳」（ADR-0002 柱三 / 原则①：固定的归确定性，LLM 只补页面内容）。
 *
 * 单次 LLM 生成整个 SPA 会顶死 deepseek-chat ~8K token 输出上限，丰富内容装不下。
 * 改为：平台确定性地搭好外壳（CDN/daisyUI/主题 + 侧栏导航 + navigate() 切页 + 页面插槽），
 * 每个页面内容由独立 LLM 调用单独生成（各自享有完整输出预算），最后拼装回插槽。
 * 外壳零 LLM、每次一致——既省输出预算，也消除导航/切页样板的不一致与 bug。
 */

export interface ShellPage {
  key: string; // 资源/页面 key（用于 navigate 与插槽定位，须为 [\w-]+）
  label: string; // 侧栏菜单中文名
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/** 页面内容插槽占位符（HTML 注释，不干扰渲染，便于确定性 string 替换） */
export const pageSlot = (key: string): string => `<!--TIP_PAGE:${key}-->`;

/**
 * 搭建确定性 SPA 外壳：head(CDN/主题) + 侧栏菜单 + 每页一个 data-page section（含内容插槽）
 * + navigate() 切页脚本。首页（第一项）默认显示，其余 display:none。
 */
export function buildDemoShell(opts: {
  appName: string;
  tailwindCdn: string;
  daisyuiCss: string;
  pages: ShellPage[];
}): string {
  const safeName = escapeHtml((opts.appName || '应用').slice(0, 40));
  const pages = opts.pages.filter((p) => /^[\w-]+$/.test(p.key));

  const menu = pages
    .map(
      (p) =>
        `      <li><a onclick="navigate('${p.key}')" data-page-link="${p.key}" class="tip-nav">${escapeHtml(p.label)}</a></li>`,
    )
    .join('\n');

  const sections = pages
    .map(
      (p, i) =>
        `    <section data-page="${p.key}" class="tip-page"${i === 0 ? '' : ' style="display:none"'}>\n${pageSlot(p.key)}\n    </section>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="corporate">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName}</title>
<script src="${opts.tailwindCdn}"></script>
<link href="${opts.daisyuiCss}" rel="stylesheet" type="text/css" />
</head>
<body class="bg-base-200 text-base-content">
<div class="flex min-h-screen">
  <aside class="w-56 shrink-0 bg-base-100 p-4">
    <div class="mb-4 text-lg font-bold text-primary">${safeName}</div>
    <ul class="menu gap-1">
${menu}
    </ul>
  </aside>
  <main id="tip-content" class="flex-1 overflow-auto p-6">
${sections}
  </main>
</div>
<script>
function navigate(k){
  document.querySelectorAll('.tip-page').forEach(function(s){ s.style.display = (s.getAttribute('data-page')===k ? '' : 'none'); });
  document.querySelectorAll('.tip-nav').forEach(function(a){ a.classList.toggle('menu-active', a.getAttribute('data-page-link')===k); });
  window.scrollTo(0,0);
}
</script>
</body>
</html>`;
}

/** 把各页生成内容拼回外壳插槽。缺失的页填空字符串（不留占位注释）。 */
export function assembleDemoPages(shell: string, pageHtmls: Record<string, string>): string {
  return shell.replace(/<!--TIP_PAGE:([\w-]+)-->/g, (_m, key: string) => pageHtmls[key] ?? '');
}
