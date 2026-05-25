import { Test, TestingModule } from '@nestjs/testing';
import { ErrorMatcherService } from './error-matcher.service';
import { PrismaService } from '../database/prisma.service';

describe('ErrorMatcherService', () => {
  let service: ErrorMatcherService;
  let prisma: PrismaService;

  const mockPatterns = [
    {
      id: 'pattern-1',
      patternKey: 'html_parse_error',
      name: 'HTML 解析错误',
      signals: {
        regex: ['SyntaxError.*unexpected token', 'Unexpected token.*in JSON'],
        keywords: ['解析失败', '格式错误'],
      },
      recommendedActions: {
        fixPrompt: '检查 HTML 标签是否闭合，JSON 格式是否正确',
      },
      autoFixable: true,
      severity: 'high',
      stage: 'p3_verify',
      commonCauses: ['HTML 标签未闭合', 'JSON 解析失败'],
      createdAt: new Date(),
      updatedAt: new Date(),
      successRate: null,
      publicName: null,
    },
    {
      id: 'pattern-2',
      patternKey: 'deepseek_timeout',
      name: 'DeepSeek 超时',
      signals: {
        regex: ['timeout', 'ETIMEDOUT', 'Timeout'],
        keywords: ['超时', 'timeout', '无响应'],
      },
      recommendedActions: {
        fallbackStrategy: 'retry_with_backoff',
      },
      autoFixable: false,
      severity: 'medium',
      stage: 'deepseek_call',
      commonCauses: ['网络波动', 'API 负载高'],
      createdAt: new Date(),
      updatedAt: new Date(),
      successRate: null,
      publicName: null,
    },
  ];

  const mockPrismaService = {
    errorPattern: {
      findMany: jest.fn(),
    },
    errorEvent: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorMatcherService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ErrorMatcherService>(ErrorMatcherService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should load patterns from database on init', async () => {
      mockPrismaService.errorPattern.findMany.mockResolvedValue(mockPatterns);

      await service.onModuleInit();

      // Verify patterns are loaded by testing a match
      const match = await service.matchError('SyntaxError: unexpected token');
      expect(match).not.toBeNull();
      expect(match!.pattern.patternKey).toBe('html_parse_error');
    });

    it('should handle database error gracefully', async () => {
      mockPrismaService.errorPattern.findMany.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('matchError', () => {
    beforeEach(async () => {
      mockPrismaService.errorPattern.findMany.mockResolvedValue(mockPatterns);
      await service.onModuleInit();
    });

    it('should match by regex pattern', async () => {
      const match = await service.matchError('SyntaxError: unexpected token at position 42');
      expect(match).not.toBeNull();
      expect(match!.pattern.patternKey).toBe('html_parse_error');
      expect(match!.confidence).toBe(0.9);
    });

    it('should match by keywords (at least 2 keywords required)', async () => {
      const match = await service.matchError('解析失败：输入格式错误');
      expect(match).not.toBeNull();
      expect(match!.pattern.patternKey).toBe('html_parse_error');
    });

    it('should return null when no pattern matches', async () => {
      const match = await service.matchError('完全无关的错误信息');
      expect(match).toBeNull();
    });

    it('should handle empty error text', async () => {
      const match = await service.matchError('');
      expect(match).toBeNull();
    });

    it('should match timeout pattern', async () => {
      const match = await service.matchError('Connection timeout after 30s');
      expect(match).not.toBeNull();
      expect(match!.pattern.patternKey).toBe('deepseek_timeout');
    });
  });

  describe('recordError', () => {
    it('should create an error event record', async () => {
      mockPrismaService.errorEvent.create.mockResolvedValue({ id: 'event-1' });

      await service.recordError({
        projectId: 'project-1',
        taskId: 'task-1',
        rawError: 'SyntaxError: unexpected token',
        patternId: 'pattern-1',
        stage: 'p3_verify',
        actionTaken: 'retry',
      });

      expect(mockPrismaService.errorEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'project-1',
          taskId: 'task-1',
          patternId: 'pattern-1',
          stage: 'p3_verify',
          actionTaken: 'retry',
        }),
      });
    });

    it('should sanitize raw error before saving', async () => {
      mockPrismaService.errorEvent.create.mockResolvedValue({ id: 'event-1' });

      await service.recordError({
        projectId: 'project-1',
        taskId: 'task-1',
        rawError: 'Error: email user@example.com and sk-abc123def456ghi7890123',
        stage: 'p3_verify',
      });

      const callArg = mockPrismaService.errorEvent.create.mock.calls[0][0];
      expect(callArg.data.sanitizedError).not.toContain('user@example.com');
      expect(callArg.data.sanitizedError).not.toContain('sk-abc123def456ghi7890123');
      expect(callArg.data.sanitizedError).toContain('[email]');
      expect(callArg.data.sanitizedError).toContain('[api-key]');
    });
  });

  describe('buildFixPrompt', () => {
    it('should build fix prompt with error and fix suggestion', async () => {
      const prompt = service.buildFixPrompt(mockPatterns[0], 'SyntaxError');
      expect(prompt).toContain('SyntaxError');
      expect(prompt).toContain('检查 HTML 标签是否闭合');
    });
  });

  describe('refreshCache', () => {
    it('should reload patterns from database', async () => {
      mockPrismaService.errorPattern.findMany.mockResolvedValue(mockPatterns);

      await service.refreshCache();

      expect(mockPrismaService.errorPattern.findMany).toHaveBeenCalled();
    });
  });
});
