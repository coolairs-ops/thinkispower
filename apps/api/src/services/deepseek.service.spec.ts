import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeepseekService } from './deepseek.service';
import * as https from 'node:https';

jest.mock('node:https', () => ({
  request: jest.fn(),
  Agent: jest.fn().mockImplementation(() => ({})),
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

  // ═══ 自愈闸门测试（2026-06-02 新增） ═══
  describe('闸门测试 (需API key)', () => {
    beforeEach(async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'DEEPSEEK_API_KEY') return '***';
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
  describe('闸门1: validateStructure', () => {
    it('短文本不通过', () => {
      const r = service.validateStructure('short');
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('过短');
    });

    it('<500字节不通过', () => {
      const r = service.validateStructure('x'.repeat(300));
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('不完整');
    });

    it('带 markdown 围栏的完整 HTML 通过（剥围栏后校验，修复生成死锁）', () => {
      const html = '```html\n<!DOCTYPE html>\n<html><head></head><body><div>' + 'x'.repeat(500) + '</div></body></html>\n```';
      const r = service.validateStructure(html);
      expect(r.valid).toBe(true);
    });

    it('HTML缺失DOCTYPE不通过', () => {
      const html = '<html><head></head><body><div>' + 'x'.repeat(500) + '</div></body></html>';
      const r = service.validateStructure(html);
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('DOCTYPE');
    });

    it('HTML无闭合标签不通过', () => {
      const html = '<!DOCTYPE html>\n<html><head></head><body><div>' + 'x'.repeat(500) + '</div></body>';
      const r = service.validateStructure(html);
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('不完整');
    });

    it('完整HTML通过', () => {
      const html = '<!DOCTYPE html>\n<html><head></head><body><div>' + 'x'.repeat(500) + '</div></body></html>';
      const r = service.validateStructure(html);
      expect(r.valid).toBe(true);
    });

    it('纯文本(500+字节)通过', () => {
      // DeepSeek 可能返回纯文本而非 HTML
      const text = 'x'.repeat(600);
      const r = service.validateStructure(text);
      expect(r.valid).toBe(true);
    });
  });

  describe('闸门2: validateContent', () => {
    it('抱歉无法完成 — 不通过', () => {
      const r = service.validateContent('抱歉，我无法完成这个任务');
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('无法');
    });

    it('请求超时 — 不通过', () => {
      const r = service.validateContent('请求超时 Request timeout');
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('超时');
    });

    it('发生错误 — 不通过', () => {
      const r = service.validateContent('处理过程中遇到错误');
      expect(r.valid).toBe(false);
    });

    it('正常内容 — 通过', () => {
      const r = service.validateContent('这是正常的功能描述，没有任何错误');
      expect(r.valid).toBe(true);
    });

    it('HTML Demo — 通过', () => {
      const r = service.validateContent('<!DOCTYPE html><html>客户管理系统演示</html>');
      expect(r.valid).toBe(true);
    });
  });

  describe('chatWithRetry 自愈重试', () => {
    it('第一次成功直接返回', async () => {
      // 返回完整HTML，应通过所有闸门
      const html = '<!DOCTYPE html>\n<html><head></head><body><div>' + 'x'.repeat(500) + '</div></body></html>';
      mockHttpsSuccess({ choices: [{ message: { content: html } }] });

      const result = await service.chatWithRetry(
        [{ role: 'user', content: '生成Demo' }],
        { temperature: 0.3, expectHtml: true },
      );

      expect(result).toBe(html);
      // 只调用一次
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    it('闸门1失败触发重试', async () => {
      // 第一次返回过短(不通过闸门1)，第二次返回正常
      const badHtml = 'too short';
      const goodHtml = '<!DOCTYPE html>\n<html><head></head><body><div>' + 'x'.repeat(500) + '</div></body></html>';
      
      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((_opts: any, callback: (r: any) => void) => {
        callCount++;
        const body = callCount === 1 ? { choices: [{ message: { content: badHtml } }] }
                                      : { choices: [{ message: { content: goodHtml } }] };
        const res = { on: jest.fn((event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
          if (event === 'end') cb();
        }), statusCode: 200 };
        callback(res);
        return { on: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
      });

      const result = await service.chatWithRetry(
        [{ role: 'user', content: '生成Demo' }],
        { temperature: 0.3, expectHtml: true },
      );

      expect(result).toBe(goodHtml);
      expect(callCount).toBe(2);
    });

    it('闸门2失败触发重试', async () => {
      // 第一次返回AI错误文本，第二次正常
      const badContent = '<!DOCTYPE html>\n<html><head></head><body><p>' + '抱歉，我无法完成'.repeat(20) + '</p></body></html>';
      const goodHtml = '<!DOCTYPE html>\n<html><head></head><body><div>' + 'x'.repeat(500) + '</div></body></html>';
      
      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((_opts: any, callback: (r: any) => void) => {
        callCount++;
        const body = callCount === 1 ? { choices: [{ message: { content: badContent } }] }
                                      : { choices: [{ message: { content: goodHtml } }] };
        const res = { on: jest.fn((event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
          if (event === 'end') cb();
        }), statusCode: 200 };
        callback(res);
        return { on: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
      });

      const result = await service.chatWithRetry(
        [{ role: 'user', content: '生成Demo' }],
        { temperature: 0.3, expectHtml: true },
      );

      expect(result).toBe(goodHtml);
      expect(callCount).toBe(2);
    });

    it('三次全部失败返回null', async () => {
      const badHtml = 'too short'; // 每次都过短
      mockHttpsSuccess({ choices: [{ message: { content: badHtml } }] });

      const result = await service.chatWithRetry(
        [{ role: 'user', content: '生成Demo' }],
        { temperature: 0.3, expectHtml: true },
      );

      expect(result).toBeNull();
      expect(https.request).toHaveBeenCalledTimes(3);
    });

    it('非HTML模式跳过闸门1', async () => {
      const text = '这是纯文本回复'; // <500字节但expectHtml=false跳过闸门1
      mockHttpsSuccess({ choices: [{ message: { content: text } }] });

      const result = await service.chatWithRetry(
        [{ role: 'user', content: '你好' }],
        { temperature: 0.3, expectHtml: false },
      );

      expect(result).toBe(text);
      expect(https.request).toHaveBeenCalledTimes(1);
    });
  });

  }); // close 闸门测试
});
