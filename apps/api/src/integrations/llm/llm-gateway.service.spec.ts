import { ConfigService } from '@nestjs/config';
import { LlmGatewayService, isLocalEndpoint } from './llm-gateway.service';

function mockConfig(env: Record<string, string>): ConfigService {
  return { get: (k: string, d?: string) => env[k] ?? d } as unknown as ConfigService;
}

describe('isLocalEndpoint', () => {
  it.each([
    ['http://localhost:8000/v1', true],
    ['http://127.0.0.1:8000/v1', true],
    ['http://192.168.1.10:8000/v1', true],
    ['http://10.0.0.5/v1', true],
    ['http://172.16.0.3/v1', true],
    ['http://llm.internal/v1', true],
    ['http://gpu.local/v1', true],
    ['https://api.deepseek.com/v1', false],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', false],
    ['not-a-url', false],
  ])('%s → 域内=%s', (url, expected) => {
    expect(isLocalEndpoint(url)).toBe(expected);
  });
});

describe('LlmGatewayService 外呼阻断', () => {
  it('cloud 模式：aiMode=cloud', () => {
    const gw = new LlmGatewayService(mockConfig({ AI_MODE: 'cloud' }));
    expect(gw.aiMode).toBe('cloud');
  });

  it('local 模式 + 公有端点 → 硬阻断外呼(抛错，不发请求)', async () => {
    const gw = new LlmGatewayService(
      mockConfig({ AI_MODE: 'local', DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1' }),
    );
    await expect(gw.chat('text-primary', { user: 'hi' })).rejects.toThrow(/禁止外呼/);
  });

  it('local 模式 + 公有视觉端点 → 同样阻断', async () => {
    const gw = new LlmGatewayService(
      mockConfig({ AI_MODE: 'local', QWEN_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }),
    );
    await expect(gw.vision('看这张图', ['data:image/png;base64,xxx'])).rejects.toThrow(/禁止外呼/);
  });

  it('cloud 模式 + 公有端点 → 不被外呼阻断(放行，错误来自网络而非阻断)', async () => {
    const gw = new LlmGatewayService(
      mockConfig({ AI_MODE: 'cloud', DEEPSEEK_BASE_URL: 'http://127.0.0.1:9/v1', DEEPSEEK_API_KEY: 'x' }),
    );
    await expect(gw.chat('text-primary', { user: 'hi' }, { timeoutMs: 300 })).rejects.not.toThrow(/禁止外呼/);
  });
});
