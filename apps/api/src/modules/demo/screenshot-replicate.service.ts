import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { LlmGatewayService } from '../../integrations/llm/llm-gateway.service';

/** 看图复刻的「布局描述」prompt（vision 段：只看懂、出短结构，不吐代码——规避 vision 长代码退化） */
const DESCRIBE_PROMPT =
  '仔细观察这张产品原型截图，只用简洁的结构化 JSON 描述页面结构，不要生成任何 HTML/CSS。字段：' +
  '{"layout":"整体布局","sidebar":{"brand":"","menu":["菜单项"],"active":"选中项","footer":"底部信息"},' +
  '"main":{"title":"","filters":["筛选控件"],"primaryActions":["主按钮"],' +
  '"content":{"type":"卡片网格/表格","columns":数字,"cardFields":["卡片字段"],"sampleItems":[{"name":"","meta":"","tags":["标签"],"owner":""}]},' +
  '"pagination":""},"palette":{"primary":"主色hex","bg":"背景hex"}}。只输出 JSON。';

/** 据布局描述生成 daisyUI 页面的 prompt（text 段：擅长吐长代码） */
const GENERATE_SYSTEM =
  '你是资深前端工程师。下面是一张产品原型的结构化布局描述(JSON)。请据此生成一个单文件 HTML 页面，' +
  '在 <head> 引入 `https://cdn.tailwindcss.com` 与 `https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css`，' +
  '根元素 `<html data-theme="corporate">`，用 daisyUI 语义 class(btn/card/navbar/menu/table/stats/input/badge 等)尽量还原布局、组件、配色与文案。' +
  '每个可操作元素(按钮/输入/卡片/表格/菜单项)加 `data-module-key` 与 `data-element-path`(kebab-case)，侧栏菜单项与页面大标题不要加 data-module-key。' +
  '只输出完整 HTML 代码本身，不要解释、不要用 markdown 代码块包裹。';

/**
 * 截图复刻服务（私有化下的"看图复刻"——两段式）。
 *
 * 验证结论：vision 模型直接吐长 HTML 会退化/截断；故拆两段——
 * ① vision(qwen-vl) 看图 → 结构化布局描述(短，稳)；② text(deepseek) 按描述 → daisyUI HTML(长代码稳)。
 * 两段都经 LlmGateway，AI_MODE=local 时全程域内，守"数据不出域"。
 */
@Injectable()
export class ScreenshotReplicateService {
  private readonly logger = new Logger(ScreenshotReplicateService.name);

  constructor(private llm: LlmGatewayService) {}

  /** 看一张截图，复刻成 daisyUI 单页 HTML */
  async replicate(imageDataUrl: string, pageName?: string): Promise<string> {
    const layout = await this.describeLayout(imageDataUrl);
    return this.generateHtml(layout, pageName);
  }

  /** 第一段：vision 看图 → 结构化布局描述 */
  async describeLayout(imageDataUrl: string): Promise<string> {
    return this.llm.vision(DESCRIBE_PROMPT, [imageDataUrl], { maxTokens: 1500, temperature: 0.2 });
  }

  /** 第二段：text 按布局描述 → daisyUI 页面 HTML */
  async generateHtml(layoutDescription: string, pageName?: string): Promise<string> {
    const raw = await this.llm.chat(
      'text-primary',
      { system: GENERATE_SYSTEM, user: `页面名称：${pageName || '页面'}\n布局描述：\n${layoutDescription}` },
      { maxTokens: 8000, temperature: 0.2 },
    );
    return this.cleanHtml(raw);
  }

  /** 把多张复刻页拼成一个带顶部 tab 切换的 daisyUI 单文件 SPA（每张截图=一页） */
  assembleMultiPage(pages: Array<{ name: string; html: string }>): string {
    const tabs: string[] = [];
    const bodies: string[] = [];
    pages.forEach((p, i) => {
      const $ = cheerio.load(p.html);
      const body = $('body').html() || p.html;
      const key = 'p' + i;
      const name = this.esc(p.name || `页面${i + 1}`);
      tabs.push(`<button class="rtab${i === 0 ? ' active' : ''}" onclick="rnav('${key}',this)">${name}</button>`);
      bodies.push(`<section class="rpage${i === 0 ? ' active' : ''}" id="rp-${key}">${body}</section>`);
    });
    return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="corporate">
<head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css" rel="stylesheet" type="text/css"/>
<style>.rpage{display:none}.rpage.active{display:block}.rtabs{display:flex;gap:6px;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;flex-wrap:wrap}.rtab{font-size:13px;padding:5px 12px;border:1px solid #d8dce3;border-radius:6px;background:#fff;cursor:pointer}.rtab.active{background:#2f6fed;color:#fff;border-color:#2f6fed}</style>
</head>
<body>
<div class="rtabs">${tabs.join('')}</div>
${bodies.join('\n')}
<script>function rnav(k,el){document.querySelectorAll('.rpage').forEach(function(e){e.classList.remove('active')});var t=document.getElementById('rp-'+k);if(t)t.classList.add('active');document.querySelectorAll('.rtab').forEach(function(e){e.classList.remove('active')});if(el)el.classList.add('active');}</script>
</body>
</html>`;
  }

  private esc(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 去掉模型偶尔加的 markdown 代码块包裹 */
  private cleanHtml(s: string): string {
    return (s || '').replace(/^```html\s*/i, '').replace(/```\s*$/, '').trim();
  }
}
