import { Test, TestingModule } from '@nestjs/testing';
import { HermesQualityService } from './hermes-quality.service';
import { DeepseekService } from './deepseek.service';

describe('HermesQualityService', () => {
  let service: HermesQualityService;
  let deepseek: DeepseekService;

  const mockDeepseekService = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HermesQualityService,
        { provide: DeepseekService, useValue: mockDeepseekService },
      ],
    }).compile();

    service = module.get<HermesQualityService>(HermesQualityService);
    deepseek = module.get<DeepseekService>(DeepseekService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeResponse', () => {
    it('should return empty hints when no user messages', async () => {
      const result = await service.analyzeResponse([]);
      expect(result.hints).toEqual([]);
      expect(result.needsFollowUp).toBe(false);
    });

    it('should detect vague terms and return hints', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        consistency: { hasContradiction: false, contradictionDescription: null },
        ambiguity: { isVague: true, vagueTerms: ['大概', '差不多'], vagueSuggestion: '用户说"大概"，建议追问具体数量或标准' },
        dimensions: { coveredDimensions: ['目标用户'], missingDimensions: [], suggestedDimension: null },
      }));

      const result = await service.analyzeResponse([
        { role: 'user', content: '大概差不多就行了' },
      ]);

      expect(result.hints).toHaveLength(1);
      expect(result.hints[0]).toContain('模糊表达');
      expect(result.hints[0]).toContain('大概');
      expect(result.needsFollowUp).toBe(true);
    });

    it('should detect contradiction and return hints', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        consistency: { hasContradiction: true, contradictionDescription: '用户之前说给老板看，现在说主要给自己用' },
        ambiguity: { isVague: false, vagueTerms: [], vagueSuggestion: null },
        dimensions: { coveredDimensions: [], missingDimensions: [], suggestedDimension: null },
      }));

      const result = await service.analyzeResponse([
        { role: 'user', content: '这个产品主要给老板看的' },
        { role: 'assistant', content: '好的，了解' },
        { role: 'user', content: '其实主要是我自己用' },
      ]);

      expect(result.hints).toHaveLength(1);
      expect(result.hints[0]).toContain('给老板看');
      expect(result.needsFollowUp).toBe(true);
    });

    it('should detect missing dimensions every 3 rounds', async () => {
      const userMessages: { role: 'user'; content: string }[] = Array(3).fill(null).map((_, i) => ({
        role: 'user' as const,
        content: `消息 ${i + 1}`,
      }));
      const assistantMessages: { role: 'assistant'; content: string }[] = userMessages.slice(0, -1).map(() => ({
        role: 'assistant' as const,
        content: '好的',
      }));

      const allMessages: { role: string; content: string }[] = [];
      for (let i = 0; i < userMessages.length; i++) {
        allMessages.push(userMessages[i]);
        if (assistantMessages[i]) allMessages.push(assistantMessages[i]);
      }

      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        consistency: { hasContradiction: false, contradictionDescription: null },
        ambiguity: { isVague: false, vagueTerms: [], vagueSuggestion: null },
        dimensions: {
          coveredDimensions: ['目标用户', '用户痛点'],
          missingDimensions: ['核心价值', 'MVP 范围', '成功标准'],
          suggestedDimension: '建议下一轮探索核心价值维度',
        },
      }));

      const result = await service.analyzeResponse(allMessages);

      expect(result.hints).toHaveLength(1);
      expect(result.hints[0]).toContain('尚未覆盖');
      expect(result.hints[0]).toContain('核心价值');
      expect(result.needsFollowUp).toBe(true);
    });

    it('should not report missing dimensions before 3 rounds', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        consistency: { hasContradiction: false, contradictionDescription: null },
        ambiguity: { isVague: false, vagueTerms: [], vagueSuggestion: null },
        dimensions: {
          coveredDimensions: [],
          missingDimensions: ['核心价值', 'MVP 范围'],
          suggestedDimension: null,
        },
      }));

      const result = await service.analyzeResponse([
        { role: 'user', content: '我想做个软件' },
      ]);

      // Only 1 user message, dimension check should not trigger
      expect(result.hints).toHaveLength(0);
      expect(result.needsFollowUp).toBe(false);
    });

    it('should combine multiple issues into multiple hints', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        consistency: { hasContradiction: true, contradictionDescription: '用户说法前后矛盾' },
        ambiguity: { isVague: true, vagueTerms: ['可能'], vagueSuggestion: '追问具体细节' },
        dimensions: {
          coveredDimensions: ['目标用户'],
          missingDimensions: ['核心价值'],
          suggestedDimension: '建议探索核心价值',
        },
      }));

      const userMessages: { role: 'user'; content: string }[] = Array(3).fill(null).map(() => ({
        role: 'user' as const,
        content: '消息',
      }));
      const assistantMessages: { role: 'assistant'; content: string }[] = userMessages.slice(0, -1).map(() => ({
        role: 'assistant' as const,
        content: '好的',
      }));
      const allMessages: { role: string; content: string }[] = [];
      for (let i = 0; i < userMessages.length; i++) {
        allMessages.push(userMessages[i]);
        if (assistantMessages[i]) allMessages.push(assistantMessages[i]);
      }

      const result = await service.analyzeResponse(allMessages);

      expect(result.hints.length).toBeGreaterThanOrEqual(2);
      expect(result.needsFollowUp).toBe(true);
    });

    it('should handle DeepSeek returning invalid JSON gracefully', async () => {
      mockDeepseekService.chat.mockResolvedValue('not valid json');

      const result = await service.analyzeResponse([
        { role: 'user', content: '你好' },
      ]);

      expect(result.hints).toEqual([]);
      expect(result.needsFollowUp).toBe(false);
    });

    it('should handle DeepSeek throwing an error gracefully', async () => {
      mockDeepseekService.chat.mockRejectedValue(new Error('API error'));

      const result = await service.analyzeResponse([
        { role: 'user', content: '你好' },
      ]);

      expect(result.hints).toEqual([]);
      expect(result.needsFollowUp).toBe(false);
    });
  });

  describe('validatePrd', () => {
    it('should return valid for a well-formed PRD', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        isValid: true,
        issues: [],
        suggestion: null,
      }));

      const validPrd = {
        productName: '客户管理系统',
        summary: '帮助销售人员跟踪客户跟进状态的工具',
        targetUsers: ['销售员', '销售经理'],
        userPainPoints: ['客户信息散落在Excel中', '跟进状态不透明'],
        mvpScope: ['客户信息管理', '跟进记录', '数据看板'],
        pages: ['登录页', '客户列表', '客户详情'],
        features: ['客户增删改查', '跟进记录管理', '销售数据统计'],
      };

      const result = await service.validatePrd(validPrd);

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect issues in a poor PRD', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        isValid: false,
        issues: ['targetUsers 太泛，建议追问具体是什么角色'],
        suggestion: '建议继续追问目标用户的具体身份',
      }));

      const poorPrd = {
        productName: '系统',
        summary: '业务管理系统',
        targetUsers: ['用户'],
        userPainPoints: ['效率低'],
        mvpScope: ['基础功能'],
        pages: ['首页'],
        features: ['管理'],
      };

      const result = await service.validatePrd(poorPrd);

      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.suggestion).toBeTruthy();
    });

    it('should default to valid when DeepSeek errors', async () => {
      mockDeepseekService.chat.mockRejectedValue(new Error('API error'));

      const result = await service.validatePrd({ productName: 'test' });

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should handle non-JSON DeepSeek response', async () => {
      mockDeepseekService.chat.mockResolvedValue('bad response');

      const result = await service.validatePrd({ productName: 'test' });

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });
});
