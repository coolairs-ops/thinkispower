import { HtmlModuleExtractorService } from './html-module-extractor.service';

describe('HtmlModuleExtractorService', () => {
  let service: HtmlModuleExtractorService;

  const sampleSpaHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>测试 Demo</title>
  <style>body { font-family: sans-serif; }</style>
</head>
<body>
  <nav>
    <a class="nav-item" data-route="dashboard" onclick="navigate('dashboard')">看板</a>
    <a class="nav-item" data-route="customer-list" onclick="navigate('customer-list')">客户列表</a>
    <a class="nav-item" data-route="reports" onclick="navigate('reports')">报表</a>
  </nav>
  <div id="main-content"></div>
  <script>
    var pages = {
      'dashboard': { render: function() { return \`<div data-module-key="dashboard"><h1>看板</h1><p>概览数据</p></div>\`; }, name: '看板' },
      'customer-list': { render: function() { return \`<div data-module-key="customer-list"><h1>客户列表</h1><table><tr><td>客户A</td></tr></table></div>\`; }, name: '客户列表' },
      'reports': { render: function() { return \`<div data-module-key="reports"><h1>报表</h1><canvas>图表</canvas></div>\`; }, name: '报表' },
    };
    function navigate(key) {
      var page = pages[key];
      if (page) {
        document.getElementById('main-content').innerHTML = page.render();
      }
    }
    navigate('dashboard');
  </script>
</body>
</html>`;

  beforeEach(() => {
    service = new HtmlModuleExtractorService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extractRenderContent', () => {
    it('should extract render content for existing module', () => {
      const content = service.extractRenderContent(sampleSpaHtml, 'dashboard');
      expect(content).not.toBeNull();
      expect(content).toContain('看板');
      expect(content).toContain('概览数据');
    });

    it('should return null for non-existent module', () => {
      const content = service.extractRenderContent(sampleSpaHtml, 'non-existent');
      expect(content).toBeNull();
    });

    it('should return null for empty html', () => {
      const content = service.extractRenderContent('', 'dashboard');
      expect(content).toBeNull();
    });
  });

  describe('buildCondensedHtml', () => {
    it('should preserve target module render content', () => {
      const condensed = service.buildCondensedHtml(sampleSpaHtml, 'customer-list');
      expect(condensed).toContain('客户A');
      expect(condensed).toContain('客户列表');
    });

    it('should replace non-target modules with placeholder', () => {
      const condensed = service.buildCondensedHtml(sampleSpaHtml, 'customer-list');
      expect(condensed).toContain('<!-- module dashboard: preserved -->');
      expect(condensed).toContain('<!-- module reports: preserved -->');
    });

    it('should preserve navigation and head structure', () => {
      const condensed = service.buildCondensedHtml(sampleSpaHtml, 'customer-list');
      expect(condensed).toContain('<!DOCTYPE');
      expect(condensed).toContain('<nav>');
      expect(condensed).toContain('navigate(\'dashboard\')');
      expect(condensed).toContain('function navigate');
    });

    it('should return original HTML when target module not found', () => {
      const condensed = service.buildCondensedHtml(sampleSpaHtml, 'non-existent');
      expect(condensed).toBe(sampleSpaHtml);
    });
  });

  describe('listModules', () => {
    it('should list all modules with key and chinese name', () => {
      const modules = service.listModules(sampleSpaHtml);
      expect(modules).toEqual([
        { key: 'dashboard', name: '看板' },
        { key: 'customer-list', name: '客户列表' },
        { key: 'reports', name: '报表' },
      ]);
    });

    it('should return empty array for html without pages', () => {
      expect(service.listModules('<html><body>no modules</body></html>')).toEqual([]);
    });
  });

  describe('extractAllModuleKeys', () => {
    it('should expose all module keys for validation', () => {
      expect(service.extractAllModuleKeys(sampleSpaHtml)).toEqual([
        'dashboard',
        'customer-list',
        'reports',
      ]);
    });
  });

  describe('mergeModuleContent', () => {
    it('should merge modified module content back into original', () => {
      const modifiedHtml = sampleSpaHtml.replace(
        '客户A',
        '客户X',
      );

      const merged = service.mergeModuleContent(sampleSpaHtml, modifiedHtml, 'customer-list');
      expect(merged).toContain('客户X');
      expect(merged).toContain('看板');
      expect(merged).toContain('报表');
      expect(merged).not.toContain('客户A');
    });

    it('should return original HTML when render content unchanged', () => {
      const merged = service.mergeModuleContent(sampleSpaHtml, sampleSpaHtml, 'customer-list');
      expect(merged).toBe(sampleSpaHtml);
    });

    it('should return original HTML when module not found', () => {
      const merged = service.mergeModuleContent(sampleSpaHtml, sampleSpaHtml, 'non-existent');
      expect(merged).toBe(sampleSpaHtml);
    });
  });
});
