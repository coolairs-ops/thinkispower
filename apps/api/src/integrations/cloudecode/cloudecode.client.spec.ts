import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CloudecodeClient } from './cloudecode.client';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { DemoSnapshotService } from '../../modules/demo-snapshot/demo-snapshot.service';
import { HtmlModuleExtractorService } from '../../services/html-module-extractor.service';

describe('CloudecodeClient', () => {
  let client: CloudecodeClient;
  let prisma: PrismaService;
  let deepseek: DeepseekService;
  let demoSnapshot: DemoSnapshotService;

  const mockTask = {
    id: 'task-1',
    projectId: 'project-1',
    type: 'frontend',
    title: '修改客户列表',
    description: '在客户列表中添加一列"联系电话"',
    inputPayload: {
      moduleKey: 'customer-list',
      acceptanceCriteria: ['客户列表显示联系电话列'],
    },
    moduleId: null,
    priority: 100,
    dependencies: null,
    status: 'pending',
    resultPayload: null,
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    project: {
      id: 'project-1',
      demoHtml: '<html><body><div data-module-key="customer-list"><table><tr><td>老数据</td></tr></table></div><script>var pages={}</script></body></html>',
    },
  };

  const mockPrismaService = {
    task: {
      findUnique: jest.fn(),
    },
    project: {
      update: jest.fn(),
    },
    demoSnapshot: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockDeepseekService = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudecodeClient,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DeepseekService, useValue: mockDeepseekService },
        DemoSnapshotService,
        HtmlModuleExtractorService,
      ],
    }).compile();

    client = module.get<CloudecodeClient>(CloudecodeClient);
    prisma = module.get<PrismaService>(PrismaService);
    deepseek = module.get<DeepseekService>(DeepseekService);
    demoSnapshot = module.get<DemoSnapshotService>(DemoSnapshotService);
  });

  it('should be defined', () => {
    expect(client).toBeDefined();
  });

  describe('executeTask', () => {
    it('should execute a task and update demo HTML', async () => {
      mockPrismaService.task.findUnique.mockResolvedValue(mockTask);
      mockPrismaService.demoSnapshot.findFirst.mockResolvedValue(null);
      mockPrismaService.demoSnapshot.create.mockResolvedValue({ id: 'snap-1' });
      mockPrismaService.project.update.mockResolvedValue(mockTask.project);

      mockDeepseekService.chat.mockResolvedValue(
        '```html\n<!DOCTYPE html>\n<html><body><div data-module-key="customer-list"><table><tr><td>联系电话: 123</td></tr></table></div><script>var pages={}</script></body></html>\n```',
      );

      const result = await client.executeTask('task-1');

      expect(result.success).toBe(true);
      expect(result.summary).toContain('completed');
      expect(mockDeepseekService.chat).toHaveBeenCalled();
    });

    it('should return failure when task not found', async () => {
      mockPrismaService.task.findUnique.mockResolvedValue(null);

      const result = await client.executeTask('non-existent');

      expect(result.success).toBe(false);
      expect(result.rawError).toContain('not found');
    });

    it('should return failure when project has no demo HTML', async () => {
      const taskWithNoDemo = {
        ...mockTask,
        project: { id: 'project-1', demoHtml: null },
      };
      mockPrismaService.task.findUnique.mockResolvedValue(taskWithNoDemo);

      const result = await client.executeTask('task-1');

      expect(result.success).toBe(false);
      expect(result.rawError).toContain('No demo HTML');
    });

    it('should return failure when response has no HTML', async () => {
      mockPrismaService.task.findUnique.mockResolvedValue(mockTask);
      mockDeepseekService.chat.mockResolvedValue('this is not HTML at all');

      const result = await client.executeTask('task-1');

      expect(result.success).toBe(false);
      expect(result.rawError).toContain('Failed to extract HTML');
    });

    it('should save snapshot before modifying HTML', async () => {
      mockPrismaService.task.findUnique.mockResolvedValue(mockTask);
      mockPrismaService.demoSnapshot.findFirst.mockResolvedValue(null);
      mockPrismaService.demoSnapshot.create.mockResolvedValue({ id: 'snap-1' });
      mockPrismaService.project.update.mockResolvedValue(mockTask.project);

      mockDeepseekService.chat.mockResolvedValue(
        '```html\n<!DOCTYPE html>\n<html><body>Modified</body></html>\n```',
      );

      await client.executeTask('task-1');

      expect(mockPrismaService.demoSnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: 'pipeline_execute',
            taskId: 'task-1',
          }),
        }),
      );
    });
  });
});
