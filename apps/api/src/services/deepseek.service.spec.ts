import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeepseekService } from './deepseek.service';

describe('DeepseekService', () => {
  let service: DeepseekService;
  let originalFetch: typeof global.fetch;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('chat without API key (fallback mode)', () => {
    beforeEach(async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'DEEPSEEK_API_KEY') return '';
        return defaultValue;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeepseekService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      service = module.get<DeepseekService>(DeepseekService);
    });

    it('should return CRM fallback for customer-related queries', async () => {
      const result = await service.chat([
        { role: 'user', content: '我想做一个客户管理系统' },
        { role: 'assistant', content: '好的，能说说具体需求吗？' },
        { role: 'user', content: '给销售团队用的' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '需要管理客户信息和跟进记录' },
      ]);

      expect(result).toContain('客户管理系统');
    });

    it('should return e-commerce fallback for shopping-related queries', async () => {
      const result = await service.chat([
        { role: 'user', content: '我想做一个电商商城' },
        { role: 'assistant', content: '好的，能说说具体需求吗？' },
        { role: 'user', content: '卖东西给普通用户' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '需要商品展示和购物车功能' },
      ]);

      expect(result).toContain('电商商城系统');
    });

    it('should return OA fallback for office-related queries', async () => {
      const result = await service.chat([
        { role: 'user', content: '帮我做个 OA 审批系统' },
        { role: 'assistant', content: '好的，能说说具体需求吗？' },
        { role: 'user', content: '给公司内部员工用的' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '需要流程审批和考勤管理' },
      ]);

      expect(result).toContain('OA办公管理系统');
    });

    it('should ask questions when no specific app type detected', async () => {
      const result = await service.chat([
        { role: 'user', content: '帮我做个软件' },
      ]);

      expect(result).toContain('needMoreInfo');
      expect(result).toContain('主要给谁用');
    });

    it('should return generic fallback for empty user message', async () => {
      const result = await service.chat([
        { role: 'system', content: '你是一个助手' },
      ]);

      expect(result).toBe('请描述你想要的软件功能。');
    });
  });

  describe('chat with API key configured', () => {
    beforeEach(async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'DEEPSEEK_API_KEY') return 'sk-test-key-12345';
        return defaultValue;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeepseekService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      service = module.get<DeepseekService>(DeepseekService);
    });

    it('should call DeepSeek API and return response content', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [{ message: { content: '你好，有什么可以帮助你的？' } }],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const result = await service.chat([
        { role: 'user', content: '你好' },
      ]);

      expect(result).toBe('你好，有什么可以帮助你的？');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.deepseek.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key-12345',
          }),
        }),
      );
    });

    it('should use custom model and temperature options', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'ok' } }],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      await service.chat(
        [{ role: 'user', content: 'hi' }],
        { temperature: 0.1, maxTokens: 512, model: 'deepseek-coder' },
      );

      const callArg = (global.fetch as jest.Mock).mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      expect(body.temperature).toBe(0.1);
      expect(body.max_tokens).toBe(512);
      expect(body.model).toBe('deepseek-coder');
    });

    it('should fallback when API returns non-ok status', async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('Rate limit exceeded'),
      };
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const result = await service.chat([
        { role: 'user', content: '你好' },
      ]);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should fallback when API throws', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await service.chat([
        { role: 'user', content: '你好' },
      ]);

      expect(result).toBeTruthy();
    });
  });
});
