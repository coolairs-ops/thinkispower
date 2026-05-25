import { Test, TestingModule } from '@nestjs/testing';
import { HtmlValidatorService } from './html-validator.service';
import { DeepseekService } from './deepseek.service';
import { HtmlModuleExtractorService } from './html-module-extractor.service';

describe('HtmlValidatorService', () => {
  let service: HtmlValidatorService;
  let deepseek: DeepseekService;

  /**
   * SPA HTML fixture — data-module-key on real DOM elements outside <script>
   * reflects the actual generated HTML structure where static elements carry
   * the attribute and render() content lives inside JS template literals (backticks).
   */
  const sampleOriginalHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head><title>Demo</title></head>
<body>
  <nav>
    <a data-module-key="dashboard" data-element-path="nav-dashboard" onclick="navigate('dashboard')">看板</a>
    <a data-module-key="customer-list" data-element-path="nav-customer" onclick="navigate('customer-list')">客户列表</a>
  </nav>
  <div id="main-content"></div>
  <script>
    var pages = {
      'dashboard': { render: function() { return \`<div data-module-key="dashboard"><h1>看板</h1><p>概览数据</p></div>\`; }, name: '看板' },
      'customer-list': { render: function() { return \`<div data-module-key="customer-list"><h1>客户列表</h1><table><tr><td>客户A</td></tr></table></div>\`; }, name: '客户列表' },
    };
    function navigate(key) { document.getElementById('main-content').innerHTML = pages[key].render(); }
  </script>
</body>
</html>`;

  const sampleModifiedHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head><title>Demo</title></head>
<body>
  <nav>
    <a data-module-key="dashboard" data-element-path="nav-dashboard" onclick="navigate('dashboard')">看板</a>
    <a data-module-key="customer-list" data-element-path="nav-customer" onclick="navigate('customer-list')">客户列表</a>
  </nav>
  <div id="main-content"></div>
  <script>
    var pages = {
      'dashboard': { render: function() { return \`<div data-module-key="dashboard"><h1>看板</h1><p>概览数据</p></div>\`; }, name: '看板' },
      'customer-list': { render: function() { return \`<div data-module-key="customer-list"><h1>客户列表</h1><table><tr><td>客户X</td></tr><tr><td>客户Y</td></tr></table></div>\`; }, name: '客户列表' },
    };
    function navigate(key) { document.getElementById('main-content').innerHTML = pages[key].render(); }
  </script>
</body>
</html>`;

  const mockDeepseekService = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HtmlValidatorService,
        HtmlModuleExtractorService,
        { provide: DeepseekService, useValue: mockDeepseekService },
      ],
    }).compile();

    service = module.get<HtmlValidatorService>(HtmlValidatorService);
    deepseek = module.get<DeepseekService>(DeepseekService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateStructure', () => {
    it('should pass for well-formed HTML', () => {
      const result = service.validateStructure(sampleOriginalHtml, sampleModifiedHtml, 'customer-list');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when DOCTYPE and html tag are both missing', () => {
      const html = sampleModifiedHtml
        .replace('<!DOCTYPE html>\n', '')
        .replace('<html lang="zh-CN">', '')
        .replace('</html>', '');
      const result = service.validateStructure(sampleOriginalHtml, html, 'customer-list');
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('缺少 DOCTYPE 或 html 标签');
    });

    it('should fail when head tag is missing', () => {
      const html = sampleModifiedHtml.replace('<head><title>Demo</title></head>\n', '');
      const result = service.validateStructure(sampleOriginalHtml, html, 'customer-list');
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('缺少 head 标签');
    });

    it('should fail when body tag is missing', () => {
      const html = sampleModifiedHtml.replace('<body>', '').replace('</body>', '');
      const result = service.validateStructure(sampleOriginalHtml, html, 'customer-list');
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('缺少 body 标签');
    });

    it('should fail when pages definition is missing', () => {
      const html = sampleModifiedHtml.replace(
        /var pages\s*=\s*\{[\s\S]*?\};\s*function navigate/s,
        'function navigate',
      );
      const result = service.validateStructure(sampleOriginalHtml, html, 'customer-list');
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('pages 定义丢失');
    });

    it('should fail when target module render content is missing', () => {
      const html = sampleModifiedHtml.replace(
        /'customer-list':\s*\{[\s\S]*?name:\s*'客户列表'\s*\},/s,
        '',
      );
      const result = service.validateStructure(sampleOriginalHtml, html, 'customer-list');
      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.includes('render() 内容丢失'))).toBe(true);
    });

    it('should fail when data-module-key attributes are missing', () => {
      const html = sampleModifiedHtml.replace(/data-module-key="[^"]*"/g, '');
      const result = service.validateStructure(sampleOriginalHtml, html, 'customer-list');
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('缺少 data-module-key 属性');
    });
  });

  describe('checkRegression', () => {
    it('should pass when only target module changes', () => {
      const result = service.checkRegression(sampleOriginalHtml, sampleModifiedHtml, 'customer-list');
      expect(result.passed).toBe(true);
      expect(result.changedModules).toHaveLength(0);
    });

    it('should fail when non-target module changes', () => {
      const badHtml = sampleModifiedHtml.replace('概览数据', '概览数据已修改');
      const result = service.checkRegression(sampleOriginalHtml, badHtml, 'customer-list');
      expect(result.passed).toBe(false);
      expect(result.changedModules).toContain('dashboard');
    });

    it('should pass when original and modified are identical', () => {
      const result = service.checkRegression(sampleOriginalHtml, sampleOriginalHtml, 'customer-list');
      expect(result.passed).toBe(true);
    });
  });

  describe('validateAcceptanceCriteria', () => {
    it('should return passed=true when no criteria', async () => {
      const result = await service.validateAcceptanceCriteria('<div>content</div>', []);
      expect(result.passed).toBe(true);
    });

    it('should return passed=true when criteria is null/undefined', async () => {
      const result = await service.validateAcceptanceCriteria('<div>content</div>', null as any);
      expect(result.passed).toBe(true);
    });

    it('should use DeepSeek to validate criteria', async () => {
      mockDeepseekService.chat.mockResolvedValue(
        '✅ 通过：客户列表显示正常 — 表格中包含客户数据\n✅ 通过：客户X存在 — 已添加客户X',
      );

      const result = await service.validateAcceptanceCriteria(
        '<div>客户列表内容</div>',
        ['客户列表显示正常', '客户X存在'],
      );

      expect(mockDeepseekService.chat).toHaveBeenCalled();
      expect(result.passed).toBe(true);
    });

    it('should handle DeepSeek failure gracefully (fail open)', async () => {
      mockDeepseekService.chat.mockRejectedValue(new Error('API error'));

      const result = await service.validateAcceptanceCriteria(
        '<div>content</div>',
        ['标准1'],
      );

      expect(result.passed).toBe(true);
      expect(result.criteriaResults).toHaveLength(0);
    });
  });
});
