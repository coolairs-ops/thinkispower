import { renderSchema } from './schema-renderer';
import { renderBlock } from './block-renderer';
import { AppSchema } from './page-schema.types';

/**
 * Schema 驱动 S1：确定性渲染器证闭环——手写 schema → 整页 HTML，块真绑 appData（读/写），
 * 多页 SPA 切换，填槽转义防注入。零 LLM。
 */
const schema: AppSchema = {
  appName: '短剧剧本生成平台',
  themeId: 'gov-blue',
  pages: [
    {
      key: 'dashboard', title: '工作台', nav: { icon: 'layout-dashboard', label: '工作台' },
      blocks: [
        { type: 'kpi', bind: { resource: 'project' }, props: { label: '项目总数' } },
        { type: 'generate', bind: { resource: 'project', fields: ['outline'] }, props: { inputLabel: '剧情大纲', button: '立即生成剧本' } },
        { type: 'table', bind: { resource: 'project', fields: ['title', 'createdAt'] }, props: { title: '历史项目', rowActions: ['查看', '复用'] } },
      ],
    },
    {
      key: 'login', title: '登录', nav: { icon: 'login', label: '登录' },
      blocks: [{ type: 'form', bind: { resource: 'session', fields: ['username', 'password'] }, props: { submitLabel: '登录' } }],
    },
  ],
};

describe('renderSchema (Schema 驱动 S1 确定性块渲染器)', () => {
  it('schema → 整页 HTML：含外壳/主题/侧栏多页', () => {
    const html = renderSchema(schema);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('短剧剧本生成平台');
    expect(html).toContain('--t-header-bg:#185FA5'); // 政务蓝主题（复用 theme-tokens）
    expect(html).toContain('data-page="dashboard"');
    expect(html).toContain('data-page="login"');
  });

  it('table/kpi 块真绑 appData.list（读路径闭环）', () => {
    const html = renderSchema(schema);
    expect(html).toContain('window.appData.list');
    expect(html).toContain('"resource":"project"');
    expect(html).toContain('<th>title</th>');     // 字段进表头
    expect(html).toContain('<th>createdAt</th>');
    expect(html).toContain('历史项目');            // table 标题
  });

  it('generate/form 块真绑 appData.create（写路径，非静态占位）', () => {
    const html = renderSchema(schema);
    expect(html).toContain('window.appData.create');
    expect(html).toContain('立即生成剧本');        // generate 按钮
    expect(html).toContain('"resource":"session"'); // form 绑定
  });

  it('多页 → SPA 切换脚本 + 单一侧栏', () => {
    const html = renderSchema(schema);
    expect(html).toContain("document.querySelectorAll('section[data-page]')"); // 切页脚本
    expect((html.match(/class="nav"/g) || []).length).toBe(1);
    expect(html).toContain('工作台');
  });

  it('填槽转义防注入（字段名外来文本经 esc）', () => {
    const evil = renderSchema({ appName: 'x', pages: [{ key: 'p', title: 't', blocks: [{ type: 'table', bind: { resource: 'r', fields: ['<img src=x>'] } }] }] });
    expect(evil).toContain('&lt;img src=x&gt;');   // 表头转义
    expect(evil).not.toContain('<img src=x>');     // 不落原始标签
  });

  it('单页 schema 不注入多页切换脚本', () => {
    const html = renderSchema({ appName: 'x', pages: [{ key: 'p', title: 't', blocks: [{ type: 'richtext', props: { html: '<p>hi</p>' } }] }] });
    expect(html).not.toContain("document.querySelectorAll('section[data-page]')");
    expect(html).toContain('<p>hi</p>');
  });

  it('richtext 块去脚本防注入', () => {
    const html = renderBlock({ type: 'richtext', props: { html: '<p>ok</p><script>alert(1)</script>' } }, 'b0-0');
    expect(html).toContain('<p>ok</p>');
    expect(html).not.toContain('<script>alert(1)');
  });

  it('renderBlock 各类型基本产出（读 list / 写 create）', () => {
    expect(renderBlock({ type: 'kpi', bind: { resource: 'r' }, props: { label: 'L' } }, 'i')).toContain('appData.list');
    expect(renderBlock({ type: 'detail', bind: { resource: 'r', fields: ['a'] } }, 'i')).toContain('appData.list');
    expect(renderBlock({ type: 'form', bind: { resource: 'r', fields: ['a'] } }, 'i')).toContain('appData.create');
  });

  // 批注钩子回归修复：schema 渲染器补回 data-module-key/data-element-path + 批注点击脚本
  it('每块挂 data-module-key/data-element-path + 注入批注点击脚本（修 L1 批注覆盖率为 0 + 恢复批注）', () => {
    const html = renderSchema(schema);
    const mkCount = (html.match(/data-module-key=/g) || []).length;
    const epCount = (html.match(/data-element-path=/g) || []).length;
    // 4 个块各挂 1 对（dashboard 的 kpi/generate/table + login 的 form）；脚本里的字符串字面量另计入几个
    expect(mkCount).toBeGreaterThanOrEqual(4); // L1「批注标注」passed 需 ≥2，远超
    expect(epCount).toBeGreaterThanOrEqual(4); // ep/mk 高(实尺度~95%)→L1 批注标注 score 接近满
    // 批注交互脚本（与 demo/page 契约一致）
    expect(html).toContain("type:'element-click'");
    expect(html).toContain('data-module-key');
    expect(html).toContain('annotation-highlight');
    expect(html).toContain("d.type==='highlight-element'");
    // 侧栏导航不挂 data-module-key（不拦截切页）
    expect(html).not.toMatch(/class="nav"[^>]*data-module-key/);
  });

  // 第 7 块 qa（ADR-0008 D6 生成器词汇生长）：问答/聊天界面
  it('qa 块产出聊天界面：输入+发送+ask 自动回复+上报 create', () => {
    const html = renderBlock({ type: 'qa', bind: { resource: 'consult' }, props: { title: '在线咨询', escalateLabel: '上报管理员' } }, 'qa1');
    expect(html).toContain('在线咨询');
    expect(html).toContain('qa1-send'); // 发送按钮
    expect(html).toContain('qa1-q'); // 输入框
    expect(html).toContain('appData.ask'); // 自动回复（知识库问答）
    expect(html).toContain("appData.create"); // 未知问题上报落库
    expect(html).toContain('上报管理员');
    expect(html).toContain("status:'escalated'");
  });
});
