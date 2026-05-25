import { Test, TestingModule } from '@nestjs/testing';
import { ClarifyService } from './clarify.service';
import { DeepseekService } from './deepseek.service';

describe('ClarifyService', () => {
  let service: ClarifyService;
  let deepseek: DeepseekService;

  const mockDeepseekService = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClarifyService,
        { provide: DeepseekService, useValue: mockDeepseekService },
      ],
    }).compile();

    service = module.get<ClarifyService>(ClarifyService);
    deepseek = module.get<DeepseekService>(DeepseekService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processMessages', () => {
    it('should return structured requirement when DeepSeek says info is sufficient', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        needMoreInfo: false,
        questions: [],
        structuredRequirement: {
          summary: '客户管理系统',
          pages: ['登录页', '客户列表页', '客户详情页'],
          features: ['客户增删改查', '客户分类'],
          roles: ['管理员', '销售员'],
          dataObjects: ['客户', '跟进记录'],
        },
      }));

      const result = await service.processMessages([
        { role: 'user', content: '帮我做一个客户管理系统' },
        { role: 'assistant', content: '这个产品主要给谁用？' },
        { role: 'user', content: '给销售团队用的' },
      ]);

      expect(result.needMoreInfo).toBe(false);
      expect(result.structuredRequirement).not.toBeNull();
      expect(result.structuredRequirement!.summary).toBe('客户管理系统');
    });

    it('should return a question when DeepSeek needs more info', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        needMoreInfo: true,
        questions: ['这个产品主要给谁用？'],
        structuredRequirement: null,
      }));

      const result = await service.processMessages([
        { role: 'user', content: '帮我做个软件' },
      ]);

      expect(result.needMoreInfo).toBe(true);
      expect(result.questions).toHaveLength(1);
      expect(result.structuredRequirement).toBeNull();
    });

    it('should handle DeepSeek parse failure with fallback', async () => {
      mockDeepseekService.chat.mockResolvedValue('not valid json');

      const result = await service.processMessages([
        { role: 'user', content: '帮我做个客户管理系统' },
        { role: 'assistant', content: '这个产品主要给谁用？' },
        { role: 'user', content: '给销售团队用的' },
        { role: 'assistant', content: '还有其他需求吗？' },
        { role: 'user', content: '需要有跟进记录功能' },
      ]);

      // Fallback: userMessages.length >= 3 → needMoreInfo: false
      expect(result.needMoreInfo).toBe(false);
      expect(result.structuredRequirement).not.toBeNull();
    });

    it('should force generate requirement when exceeding max rounds', async () => {
      // Create messages that simulate MAX_CLARIFY_ROUNDS (5) exceeded
      const messages = [
        { role: 'user', content: '帮我做个系统' },
        { role: 'assistant', content: 'Q1?' },
        { role: 'user', content: 'A1' },
        { role: 'assistant', content: 'Q2?' },
        { role: 'user', content: 'A2' },
        { role: 'assistant', content: 'Q3?' },
        { role: 'user', content: 'A3' },
        { role: 'assistant', content: 'Q4?' },
        { role: 'user', content: 'A4' },
        { role: 'assistant', content: 'Q5?' },
        { role: 'user', content: 'A5' },
      ];

      // DeepSeek should NOT be called because max rounds reached
      const result = await service.processMessages(messages);

      expect(result.needMoreInfo).toBe(false);
      expect(result.structuredRequirement).not.toBeNull();
      expect(mockDeepseekService.chat).not.toHaveBeenCalled();
    });

    it('should return fallback question when messages list is short', async () => {
      mockDeepseekService.chat.mockResolvedValue('not valid json either');

      const result = await service.processMessages([
        { role: 'user', content: '随便做个东西' },
      ]);

      // Fallback: userMessages.length < 3 → needMoreInfo: true
      expect(result.needMoreInfo).toBe(true);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0]).toContain('给谁用');
    });
  });
});
