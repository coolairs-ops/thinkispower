import { SanitizeService } from './sanitize.service';

describe('SanitizeService', () => {
  let service: SanitizeService;

  beforeEach(() => {
    service = new SanitizeService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sanitizePublicText', () => {
    it('should replace n8n with friendly name (cascaded)', () => {
      // n8n → 工作流引擎 → 业务流程引擎 (cascade)
      expect(service.sanitizePublicText('使用 n8n 处理工作流')).toBe('使用 业务流程引擎 处理工作流');
    });

    it('should replace Cloudecode with friendly name', () => {
      expect(service.sanitizePublicText('Cloudecode 正在执行任务')).toBe('AI 开发助手 正在执行任务');
    });

    it('should replace 多 Agent with friendly name', () => {
      expect(service.sanitizePublicText('多 Agent 系统')).toBe('智能协作系统 系统');
    });

    it('should handle multiple replacements in one string', () => {
      const input = 'n8n + GSD 协同工作';
      const result = service.sanitizePublicText(input);
      expect(result).toContain('业务流程引擎');
      expect(result).toContain('平台引擎');
      expect(result).not.toContain('n8n');
    });

    it('should handle case-insensitive replacement', () => {
      expect(service.sanitizePublicText('N8N 工作流')).toContain('业务流程引擎');
    });

    it('should handle null or undefined gracefully', () => {
      expect(service.sanitizePublicText(null as any)).toBe('');
      expect(service.sanitizePublicText(undefined as any)).toBe('');
    });

    it('should not modify normal text', () => {
      const text = '这是一个正常的用户消息，不含任何敏感术语。';
      expect(service.sanitizePublicText(text)).toBe(text);
    });
  });

  describe('sanitizeResponseBody', () => {
    it('should sanitize string values', () => {
      const result = service.sanitizeResponseBody('n8n 工作流引擎');
      expect(result).toContain('业务流程引擎');
    });

    it('should sanitize recursively in objects', () => {
      const input = { name: '项目', engine: 'n8n' };
      const result = service.sanitizeResponseBody(input) as Record<string, string>;
      expect(result.engine).toContain('业务流程引擎');
    });

    it('should sanitize recursively in arrays', () => {
      const input = ['使用 n8n'];
      const result = service.sanitizeResponseBody(input) as string[];
      expect(result[0]).toContain('业务流程引擎');
    });

    it('should return non-string primitives as-is', () => {
      expect(service.sanitizeResponseBody(42)).toBe(42);
      expect(service.sanitizeResponseBody(true)).toBe(true);
      expect(service.sanitizeResponseBody(null)).toBe(null);
    });
  });

  describe('getBannedTerms', () => {
    it('should return all banned terms', () => {
      const terms = service.getBannedTerms();
      expect(terms).toContain('n8n');
      expect(terms).toContain('Cloudecode');
      expect(terms).toContain('Agent');
      expect(terms.length).toBeGreaterThan(10);
    });

    it('should return a copy, not the original reference', () => {
      const terms = service.getBannedTerms();
      terms.push('test');
      const terms2 = service.getBannedTerms();
      expect(terms2).not.toContain('test');
    });
  });
});
