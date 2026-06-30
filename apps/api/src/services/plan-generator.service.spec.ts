import { Test, TestingModule } from '@nestjs/testing';
import { PlanGeneratorService } from './plan-generator.service';
import { DeepseekService } from './deepseek.service';

describe('PlanGeneratorService', () => {
  let service: PlanGeneratorService;
  let deepseek: DeepseekService;

  const mockDeepseekService = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanGeneratorService,
        { provide: DeepseekService, useValue: mockDeepseekService },
      ],
    }).compile();

    service = module.get<PlanGeneratorService>(PlanGeneratorService);
    deepseek = module.get<DeepseekService>(DeepseekService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generatePlan', () => {
    it('should parse DeepSeek response and return plan', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        summary: '客户管理系统',
        pages: ['登录页', '客户列表页', '客户详情页'],
        features: ['客户增删改查', '客户分类与标签', '跟进记录'],
        roles: ['管理员 - 全部权限', '销售员 - 客户管理'],
        dataObjects: ['客户', '跟进记录', '标签'],
        estimatedDays: 10,
        estimatedPriceRange: '¥8,000-¥15,000',
        acceptanceChecklist: ['所有页面可正常打开', '客户数据增删改查正常'],
      }));

      const result = await service.generatePlan(
        { summary: '客户管理' },
        ['我想做一个客户管理系统'],
      );

      expect(result.summary).toBe('客户管理系统');
      expect(result.pages).toHaveLength(3);
      expect(result.features).toContain('客户增删改查');
      expect(result.estimatedDays).toBe(10);
      expect(result.acceptanceChecklist).toHaveLength(2);
    });

    it('should use fallback when JSON parsing fails', async () => {
      mockDeepseekService.chat.mockResolvedValue('not valid json');

      const result = await service.generatePlan(
        { summary: '客户管理', features: ['客户管理'] },
        ['我想做一个客户管理系统'],
      );

      // Fallback plan should be returned
      expect(result.summary).toContain('客户');
      expect(result.pages).toHaveLength(4);
      expect(result.estimatedDays).toBe(10);
    });

    it('should not accept empty AI arrays as a valid delivery plan', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        summary: '业务管理系统',
        pages: [],
        features: [],
        roles: [],
        dataObjects: [],
        estimatedDays: 10,
        estimatedPriceRange: '¥5,000-¥15,000',
        acceptanceChecklist: [],
      }));

      const result = await service.generatePlan({}, ['做一个系统']);

      expect(result.summary).toBe('业务管理系统');
      expect(result.pages.length).toBeGreaterThan(0);
      expect(result.features.length).toBeGreaterThan(0);
      expect(result.roles.length).toBeGreaterThan(0);
      expect(result.dataObjects.length).toBeGreaterThan(0);
      expect(result.acceptanceChecklist.length).toBeGreaterThan(0);
    });

    it('should use uplift fallback when DeepSeek fails', async () => {
      mockDeepseekService.chat.mockRejectedValue(new Error('network blocked'));

      const result = await service.generatePlan(
        {
          prd: {
            summary: '财务智能问数',
            features: ['智能问数', '文档结构化'],
            roles: ['领导用户 - 问数', '财务人员 - 上传数据'],
            dataObjects: ['财务数据', '财务文档'],
            successCriteria: ['用户能问几个财务问题并得到答案'],
          },
        },
        [],
      );

      expect(result.features).toContain('智能问数');
      expect(result.roles).toContain('领导用户 - 问数');
      expect(result.dataObjects).toContain('财务数据');
      expect(result.acceptanceChecklist).toContain('用户能问几个财务问题并得到答案');
    });

    it('should call DeepSeek with correct parameters', async () => {
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        summary: 'test',
        pages: [],
        features: [],
        roles: [],
        dataObjects: [],
        estimatedDays: 5,
        estimatedPriceRange: '¥1,000',
        acceptanceChecklist: [],
      }));

      await service.generatePlan(
        { summary: '测试项目' },
        ['我想要一个测试项目'],
      );

      expect(mockDeepseekService.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        { temperature: 0.5 },
      );
    });
  });
});
