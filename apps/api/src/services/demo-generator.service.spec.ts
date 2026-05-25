import { Test, TestingModule } from '@nestjs/testing';
import { DemoGeneratorService } from './demo-generator.service';
import { DeepseekService } from './deepseek.service';

describe('DemoGeneratorService', () => {
  let service: DemoGeneratorService;
  let deepseek: DeepseekService;

  const mockDeepseekService = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemoGeneratorService,
        { provide: DeepseekService, useValue: mockDeepseekService },
      ],
    }).compile();

    service = module.get<DemoGeneratorService>(DemoGeneratorService);
    deepseek = module.get<DeepseekService>(DeepseekService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateDemoHtml', () => {
    const samplePlan = {
      summary: '客户管理系统',
      pages: ['登录页', '客户列表', '客户详情'],
      features: ['客户增删改查', '客户分类'],
      roles: ['管理员', '销售员'],
      dataObjects: ['客户', '跟进记录'],
      estimatedDays: 10,
      estimatedPriceRange: '¥8,000-¥15,000',
      acceptanceChecklist: ['所有页面可正常打开'],
    };

    it('should extract HTML from code-fenced response', async () => {
      mockDeepseekService.chat.mockResolvedValue(
        '```html\n<!DOCTYPE html>\n<html>\n<head><title>Demo</title></head>\n<body>\n  <div id="app">客户管理系统</div>\n  <script>\n    var pages = {\n      "dashboard": { render: function() { return "<h1>看板</h1>"; }, name: "看板" }\n    };\n    function navigate(k) {}\n  </script>\n</body>\n</html>\n```',
      );

      const result = await service.generateDemoHtml(samplePlan);

      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('客户管理系统');
    });

    it('should extract HTML from plain response (no code fence)', async () => {
      mockDeepseekService.chat.mockResolvedValue(
        '<!DOCTYPE html>\n<html>\n<head><title>Demo</title></head>\n<body><div>内容</div></body>\n</html>',
      );

      const result = await service.generateDemoHtml(samplePlan);

      expect(result).toContain('<!DOCTYPE html>');
    });

    it('should throw when no HTML found in response', async () => {
      mockDeepseekService.chat.mockResolvedValue('This is just a text response without HTML');

      await expect(service.generateDemoHtml(samplePlan)).rejects.toThrow('未找到有效的 HTML 输出');
    });

    it('should call DeepSeek with appropriate parameters', async () => {
      mockDeepseekService.chat.mockResolvedValue(
        '```html\n<!DOCTYPE html>\n<html><head></head><body><div data-module-key="dashboard">内容</div></body>\n</html>\n```',
      );

      await service.generateDemoHtml(samplePlan);

      expect(mockDeepseekService.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        expect.objectContaining({
          temperature: 0.3,
          maxTokens: 8192,
        }),
      );
    });

    it('should warn but not fail when data-module-key is missing', async () => {
      mockDeepseekService.chat.mockResolvedValue(
        '```html\n<!DOCTYPE html>\n<html>\n<head><title>Demo</title></head>\n<body><div>No module keys</div></body>\n</html>\n```',
      );

      const result = await service.generateDemoHtml(samplePlan);

      expect(result).toContain('<!DOCTYPE html>');
    });
  });
});
