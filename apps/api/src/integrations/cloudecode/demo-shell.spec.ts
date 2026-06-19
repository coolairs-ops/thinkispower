import { buildDemoShell, assembleDemoPages, pageSlot } from './demo-shell';

describe('demo-shell（分段生成的确定性外壳）', () => {
  const base = {
    appName: '门店巡检系统',
    tailwindCdn: 'https://cdn/tw.js',
    daisyuiCss: 'https://cdn/daisy.css',
    pages: [
      { key: 'dashboard', label: '总览' },
      { key: 'stores', label: '门店管理' },
      { key: 'tasks', label: '任务' },
    ],
  };

  describe('buildDemoShell', () => {
    it('含 CDN/主题、每页菜单项与 data-page section、每页内容插槽', () => {
      const html = buildDemoShell(base);
      expect(html).toContain('data-theme="corporate"');
      expect(html).toContain('https://cdn/tw.js');
      expect(html).toContain('https://cdn/daisy.css');
      // 菜单 + section + 插槽
      for (const p of base.pages) {
        expect(html).toContain(`navigate('${p.key}')`);
        expect(html).toContain(`<section data-page="${p.key}"`);
        expect(html).toContain(pageSlot(p.key));
      }
      // 标题转义后的应用名
      expect(html).toContain('门店巡检系统');
      // navigate 切页脚本
      expect(html).toContain('function navigate(k)');
    });

    it('首页默认显示，其余 display:none', () => {
      const html = buildDemoShell(base);
      expect(html).toContain('<section data-page="dashboard" class="tip-page">'); // 无 style
      expect(html).toContain('<section data-page="stores" class="tip-page" style="display:none">');
    });

    it('非法 key 被剔除，应用名转义防 XSS', () => {
      const html = buildDemoShell({
        ...base,
        appName: '<script>x</script>店',
        pages: [{ key: 'ok', label: 'A' }, { key: 'bad key;', label: 'B' }],
      });
      expect(html).toContain("navigate('ok')");
      expect(html).not.toContain('bad key');
      expect(html).not.toContain('<script>x</script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('assembleDemoPages', () => {
    it('把各页内容拼回对应插槽', () => {
      const shell = buildDemoShell(base);
      const out = assembleDemoPages(shell, {
        dashboard: '<div class="card">总览内容</div>',
        stores: '<div class="card">门店内容</div>',
        tasks: '<div class="card">任务内容</div>',
      });
      expect(out).toContain('<div class="card">总览内容</div>');
      expect(out).toContain('<div class="card">门店内容</div>');
      expect(out).not.toContain('<!--TIP_PAGE:'); // 占位符全部被替换
    });

    it('缺失的页填空，不残留占位注释', () => {
      const shell = buildDemoShell(base);
      const out = assembleDemoPages(shell, { dashboard: '<p>有</p>' });
      expect(out).toContain('<p>有</p>');
      expect(out).not.toContain('<!--TIP_PAGE:stores-->');
      expect(out).not.toContain('<!--TIP_PAGE:tasks-->');
    });
  });
});
