import { Test, TestingModule } from '@nestjs/testing';
import { ProductDiscoveryService } from './product-discovery.service';
import { DeepseekService } from './deepseek.service';

describe('ProductDiscoveryService', () => {
  let service: ProductDiscoveryService;
  let deepseek: DeepseekService;

  const mockDeepseekService = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductDiscoveryService,
        { provide: DeepseekService, useValue: mockDeepseekService },
      ],
    }).compile();

    service = module.get<ProductDiscoveryService>(ProductDiscoveryService);
    deepseek = module.get<DeepseekService>(DeepseekService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processMessages', () => {
    const mockNeedMoreResponse = JSON.stringify({
      needMoreInfo: true,
      summary: '用户想做客户管理',
      question: '这个产品主要给谁用的？',
      prd: null,
    });

    it('should return needMoreInfo when AI wants to continue exploring', async () => {
      mockDeepseekService.chat.mockResolvedValue(mockNeedMoreResponse);

      const result = await service.processMessages([
        { role: 'user', content: '我想做一个客户管理系统' },
      ]);

      expect(result.needMoreInfo).toBe(true);
      expect(result.question).toBeTruthy();
      expect(result.prd).toBeNull();
    });

    it('should return PRD when AI has enough information', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        needMoreInfo: false,
        summary: '客户关系管理系统',
        question: null,
        prd: {
          productName: 'CRM系统',
          summary: '客户关系管理系统',
          background: '企业需要管理客户',
          targetUsers: ['销售员', '销售经理'],
          userPainPoints: ['客户信息分散', '跟进不及时'],
          useScenarios: ['日常销售管理'],
          coreValue: '提升销售效率',
          productForm: '网页',
          mvpScope: ['客户管理', '跟进记录', '数据统计'],
          successCriteria: ['核心功能正常'],
          pages: ['首页', '客户列表', '客户详情'],
          features: ['客户管理', '跟进记录'],
          roles: ['销售员', '管理员'],
          dataObjects: ['客户'],
          riskPoints: ['需求不明确'],
        },
      }));

      const result = await service.processMessages([
        { role: 'user', content: '我想做CRM' },
        { role: 'assistant', content: '给谁用？' },
        { role: 'user', content: '销售团队' },
      ]);

      expect(result.needMoreInfo).toBe(false);
      expect(result.prd).not.toBeNull();
      expect(result.prd?.productName).toBe('CRM系统');
      expect(result.prd?.targetUsers).toContain('销售员');
    });

    it('should inject extraSystemHints into the system prompt', async () => {
      mockDeepseekService.chat.mockResolvedValue(mockNeedMoreResponse);

      await service.processMessages(
        [{ role: 'user', content: '我想做个软件' }],
        '[注意] 用户回答中存在模糊表达（大概），建议追问具体数量或标准',
      );

      const systemMessage = mockDeepseekService.chat.mock.calls[0][0][0];
      expect(systemMessage.role).toBe('system');
      expect(systemMessage.content).toContain('Hermes 质量门禁提示');
      expect(systemMessage.content).toContain('模糊表达');
      expect(systemMessage.content).toContain('资深产品经理');
    });

    it('should NOT inject extraSystemHints when not provided', async () => {
      mockDeepseekService.chat.mockResolvedValue(mockNeedMoreResponse);

      await service.processMessages(
        [{ role: 'user', content: '我想做个软件' }],
      );

      const systemMessage = mockDeepseekService.chat.mock.calls[0][0][0];
      expect(systemMessage.role).toBe('system');
      expect(systemMessage.content).not.toContain('Hermes 质量门禁提示');
    });

    it('should force complete after 12+ rounds', async () => {
      const userMessages = Array(12).fill(null).map(() => ({
        role: 'user' as const,
        content: '继续',
      }));
      const assistantMessages = Array(11).fill(null).map(() => ({
        role: 'assistant' as const,
        content: '还有问题',
      }));

      const messages: { role: 'user' | 'assistant'; content: string }[] = [];
      for (let i = 0; i < assistantMessages.length; i++) {
        messages.push(assistantMessages[i]);
        messages.push(userMessages[i]);
      }
      messages.push(userMessages[userMessages.length - 1]);

      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        needMoreInfo: false,
        summary: '强制完成',
        question: null,
        prd: {
          productName: '系统',
          summary: '系统',
          background: '',
          targetUsers: ['用户'],
          userPainPoints: ['问题'],
          useScenarios: ['场景'],
          coreValue: '价值',
          productForm: '网页',
          mvpScope: ['功能1'],
          successCriteria: ['标准'],
          pages: ['首页'],
          features: ['功能'],
          roles: ['管理员'],
          dataObjects: [],
          riskPoints: [],
        },
      }));

      const result = await service.processMessages(messages);

      expect(result.needMoreInfo).toBe(false);
      expect(result.prd).not.toBeNull();

      // Force instruction is appended to the user message (last in array)
      const lastUserMessage = mockDeepseekService.chat.mock.calls[0][0].slice(-1)[0];
      expect(lastUserMessage.role).toBe('user');
      expect(lastUserMessage.content).toContain('直接输出 PRD');
    });

    it('should provide fallback result when DeepSeek returns non-JSON', async () => {
      mockDeepseekService.chat.mockResolvedValue('not json at all');

      const result = await service.processMessages([
        { role: 'user', content: '我想做一个客户管理系统' },
      ]);

      expect(result).toBeDefined();
      expect(result.needMoreInfo).toBeDefined();
    });

    it('should generate basic PRD from keywords after 3+ rounds on error', async () => {
      mockDeepseekService.chat.mockResolvedValue('invalid {{{ json');

      const result = await service.processMessages([
        { role: 'user', content: '我想做一个客户管理系统' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '给销售团队用' },
        { role: 'assistant', content: '了解' },
        { role: 'user', content: '需要管理客户信息' },
      ]);

      expect(result.needMoreInfo).toBe(false);
      expect(result.prd).not.toBeNull();
      expect(result.prd?.productName).toContain('客户');
    });

    it('should validate and fill missing PRD fields with defaults', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        needMoreInfo: false,
        summary: 'test',
        question: null,
        prd: {
          productName: '测试',
        },
      }));

      const result = await service.processMessages([
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'test2' },
      ]);

      expect(result.prd).not.toBeNull();
      expect(result.prd?.productName).toBe('测试');
      expect(result.prd?.targetUsers).toEqual([]);
      expect(result.prd?.pages).toEqual(['首页']);
      expect(result.prd?.roles).toEqual(['管理员']);
      expect(result.prd?.productForm).toBe('网页');
    });
  });
});
