import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HermesClient } from './hermes.client';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { StatusMapperService } from '../../services/status-mapper.service';

describe('HermesClient', () => {
  let client: HermesClient;
  let prisma: PrismaService;
  let deepseek: DeepseekService;

  const mockFeedback = {
    id: 'feedback-1',
    projectId: 'project-1',
    comment: '客户列表页面需要增加搜索功能',
    moduleKey: 'customer-list',
    elementPath: null,
    pageUrl: null,
    screenshotUrl: null,
    status: 'new',
    moduleId: null,
    generatedTaskId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    project: {
      id: 'project-1',
      demoHtml: '<html><body>Demo</body></html>',
    },
  };

  const mockPrismaService = {
    feedbackItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    task: {
      create: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockDeepseekService = {
    chat: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockStatusMapper = {
    mapProjectStatusToPublicLabel: jest.fn().mockReturnValue('测试状态'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HermesClient,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DeepseekService, useValue: mockDeepseekService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: StatusMapperService, useValue: mockStatusMapper },
      ],
    }).compile();

    client = module.get<HermesClient>(HermesClient);
    prisma = module.get<PrismaService>(PrismaService);
    deepseek = module.get<DeepseekService>(DeepseekService);
  });

  it('should be defined', () => {
    expect(client).toBeDefined();
  });

  describe('handleFeedback', () => {
    it('should decompose feedback into tasks', async () => {
      mockPrismaService.feedbackItem.findUnique.mockResolvedValue(mockFeedback);
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({
        tasks: [
          {
            type: 'frontend',
            title: '添加搜索框',
            description: '在客户列表页顶部添加搜索输入框和搜索按钮',
            moduleKey: 'customer-list',
            acceptanceCriteria: ['搜索框可见', '输入关键词可筛选'],
            priority: 100,
          },
          {
            type: 'backend',
            title: '实现搜索 API',
            description: '实现客户搜索的模拟数据过滤逻辑',
            moduleKey: 'customer-list',
            acceptanceCriteria: ['搜索返回匹配结果'],
            priority: 100,
          },
        ],
      }));

      mockPrismaService.task.create.mockResolvedValueOnce({ id: 'task-1' });
      mockPrismaService.task.create.mockResolvedValueOnce({ id: 'task-2' });
      mockPrismaService.feedbackItem.update.mockResolvedValue(mockFeedback);

      const taskIds = await client.handleFeedback('feedback-1');

      expect(taskIds).toHaveLength(2);
      expect(taskIds).toEqual(['task-1', 'task-2']);
      expect(mockPrismaService.task.create).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when feedback not found', async () => {
      mockPrismaService.feedbackItem.findUnique.mockResolvedValue(null);

      const taskIds = await client.handleFeedback('non-existent');

      expect(taskIds).toEqual([]);
    });

    it('should handle DeepSeek response that is not valid JSON', async () => {
      mockPrismaService.feedbackItem.findUnique.mockResolvedValue(mockFeedback);
      mockDeepseekService.chat.mockResolvedValue('This is not JSON at all');

      mockPrismaService.task.create.mockResolvedValue({ id: 'task-fallback' });
      mockPrismaService.feedbackItem.update.mockResolvedValue(mockFeedback);

      const taskIds = await client.handleFeedback('feedback-1');

      // Should create a single fallback task
      expect(taskIds).toHaveLength(1);
    });

    it('should call DeepSeek with correct prompt structure', async () => {
      mockPrismaService.feedbackItem.findUnique.mockResolvedValue(mockFeedback);
      mockDeepseekService.chat.mockResolvedValue(JSON.stringify({ tasks: [] }));

      await client.handleFeedback('feedback-1');

      expect(mockDeepseekService.chat).toHaveBeenCalled();
      const callArgs = mockDeepseekService.chat.mock.calls[0];
      // First message should be system prompt
      expect(callArgs[0][0].role).toBe('system');
      // Second message should be user message with feedback comment
      expect(callArgs[0][1].role).toBe('user');
      expect(callArgs[0][1].content).toContain('增加搜索功能');
    });
  });
});
