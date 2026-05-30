import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeepseekService } from './deepseek.service';
import * as https from 'node:https';

jest.mock('node:https', () => ({
  request: jest.fn(),
}));

describe('DeepseekService', () => {
  let service: DeepseekService;
  let mockReq: any;

  const mockConfigService = {
    get: jest.fn(),
  };

  /** Configure https.request to return a mock response with given statusCode and body */
  function mockHttpsSuccess(body: any) {
    const res = {
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
        if (event === 'end') cb();
      }),
      statusCode: 200,
    };
    mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
    (https.request as jest.Mock).mockImplementation((_opts: any, callback: (r: any) => void) => {
      callback(res);
      return mockReq;
    });
  }

  function mockHttpsErrorStatus(statusCode: number) {
    const res = {
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'end') cb();
      }),
      statusCode,
    };
    mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
    (https.request as jest.Mock).mockImplementation((_opts: any, callback: (r: any) => void) => {
      callback(res);
      return mockReq;
    });
  }

  function mockHttpsNetworkError() {
    let errorCb: Function | undefined;
    mockReq = {
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'error') errorCb = cb;
      }),
      write: jest.fn(),
      end: jest.fn().mockImplementation(() => {
        if (errorCb) errorCb(new Error('Network error'));
      }),
      destroy: jest.fn(),
    };
    (https.request as jest.Mock).mockReturnValue(mockReq);
  }

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
      mockHttpsSuccess({ choices: [{ message: { content: '你好，有什么可以帮助你的？' } }] });

      const result = await service.chat([
        { role: 'user', content: '你好' },
      ]);

      expect(result).toBe('你好，有什么可以帮助你的？');
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'api.deepseek.com',
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key-12345',
          }),
        }),
        expect.any(Function),
      );
    });

    it('should use custom model and temperature options', async () => {
      mockHttpsSuccess({ choices: [{ message: { content: 'ok' } }] });

      await service.chat(
        [{ role: 'user', content: 'hi' }],
        { temperature: 0.1, maxTokens: 512, model: 'deepseek-coder' },
      );

      expect(mockReq.write).toHaveBeenCalled();
      const written = mockReq.write.mock.calls[0][0];
      const body = JSON.parse(written);
      expect(body.temperature).toBe(0.1);
      expect(body.max_tokens).toBe(512);
      expect(body.model).toBe('deepseek-coder');
    });

    it('should fallback when API returns non-ok status', async () => {
      mockHttpsErrorStatus(429);

      const result = await service.chat([
        { role: 'user', content: '你好' },
      ]);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should fallback when API throws', async () => {
      mockHttpsNetworkError();

      const result = await service.chat([
        { role: 'user', content: '你好' },
      ]);

      expect(result).toBeTruthy();
    });
  });
});
