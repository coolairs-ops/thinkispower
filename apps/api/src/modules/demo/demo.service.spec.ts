import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DemoService } from './demo.service';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { DemoSnapshotService } from '../demo-snapshot/demo-snapshot.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { HermesClient } from '../../integrations/hermes/hermes.client';
import { getQueueToken } from '@nestjs/bullmq';
import { DEMO_QUEUE } from './demo.queue';
import { ThemeService } from './theme.service';
import { ScreenshotReplicateService } from './screenshot-replicate.service';
import { MinioService } from '../../integrations/minio/minio.service';

describe('DemoService', () => {
  let service: DemoService;
  let prisma: any;
  let cloudecode: any;
  let hermes: any;
  let demoQueue: any;

  const mockUserId = 'user-1';
  const mockProjectId = 'project-1';

  const baseProject = {
    id: mockProjectId,
    userId: mockUserId,
    status: 'demo_ready',
    publicStatusLabel: '预览已准备好',
    demoUrl: '/demo/project-1',
    demoHtml: '<html><body>Hello</body></html>',
  };

  const planReadyProject = {
    id: mockProjectId,
    userId: mockUserId,
    status: 'plan_ready',
    planSummary: { summary: 'Test App', pages: ['首页'], features: ['登录'] },
  };

  beforeEach(async () => {
    // Default: N8N responds ok (async will hang unless we setImmediate)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({}),
    });

    prisma = {
      project: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    cloudecode = {
      generateDemoHtmlDirect: jest.fn(),
    };

    hermes = {
      analyzeProject: jest.fn().mockResolvedValue({ summary: 'OK' }),
    };

    demoQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemoService,
        { provide: PrismaService, useValue: prisma },
        { provide: StatusMapperService, useValue: { mapProjectStatusToPublicLabel: jest.fn() } },
        { provide: DemoSnapshotService, useValue: {} },
        { provide: CloudecodeClient, useValue: cloudecode },
        { provide: HermesClient, useValue: hermes },
        { provide: getQueueToken(DEMO_QUEUE), useValue: demoQueue },
        ThemeService,
        { provide: MinioService, useValue: { downloadFile: jest.fn() } },
        { provide: ScreenshotReplicateService, useValue: { replicate: jest.fn() } },
      ],
    }).compile();

    service = module.get<DemoService>(DemoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete (global as any).fetch;
  });

  describe('getDemo', () => {
    it('should return HTML when status is demo_ready', async () => {
      prisma.project.findUnique.mockResolvedValue(baseProject);

      const result = await service.getDemo(mockUserId, mockProjectId);

      expect(result.html).toContain('Hello'); // 原内容保留
      expect(result.html).toContain('id="tip-theme"'); // 注入了主题覆盖层
      expect(result.themeConfig).toEqual({ primary: '#2563eb', mode: 'light', radius: 8, daisyTheme: 'corporate' }); // 默认主题
      expect(result.status).toBe('demo_ready');
    });

    it('should return HTML for completed status', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...baseProject, status: 'completed' });

      const result = await service.getDemo(mockUserId, mockProjectId);

      expect(result.html).toBeDefined();
    });

    it('should return null HTML when status is not ready', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...baseProject, status: 'needs_input', demoHtml: null });

      const result = await service.getDemo(mockUserId, mockProjectId);

      expect(result.html).toBeNull();
    });

    it('should return HTML when paused（自迭代需人工介入后仍可看/可编辑 demo）', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...baseProject, status: 'paused' });

      const result = await service.getDemo(mockUserId, mockProjectId);

      expect(result.html).toContain('Hello');
      expect(result.status).toBe('paused');
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.getDemo(mockUserId, mockProjectId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not owner', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...baseProject, userId: 'other' });

      await expect(service.getDemo(mockUserId, mockProjectId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('saveEditedHtml', () => {
    it('清理 tip-theme 与高亮、补 DOCTYPE 后落库', async () => {
      prisma.project.findUnique.mockResolvedValue({ userId: mockUserId });
      const dirty = '<html><head><style id="tip-theme">:root{}</style></head><body><button class="btn annotation-highlight">x</button></body></html>';
      await service.saveEditedHtml(mockUserId, mockProjectId, dirty);
      const saved = prisma.project.update.mock.calls[0][0].data.demoHtml as string;
      expect(saved).not.toContain('tip-theme');
      expect(saved).not.toContain('annotation-highlight');
      expect(saved.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(saved).toContain('class="btn');
    });

    it('跨用户 → Forbidden', async () => {
      prisma.project.findUnique.mockResolvedValue({ userId: 'other' });
      await expect(service.saveEditedHtml(mockUserId, mockProjectId, '<html>'.padEnd(60, 'x'))).rejects.toThrow(ForbiddenException);
    });

    it('空 HTML → BadRequest', async () => {
      prisma.project.findUnique.mockResolvedValue({ userId: mockUserId });
      await expect(service.saveEditedHtml(mockUserId, mockProjectId, '')).rejects.toThrow(BadRequestException);
    });
  });

  describe('generateDemo', () => {
    it('入队 BullMQ 并置 demo_generating（写 queued 进度，不直接生成）', async () => {
      prisma.project.findUnique.mockResolvedValue(planReadyProject);

      const result = await service.generateDemo(mockUserId, mockProjectId);

      expect(result).toMatchObject({ status: 'demo_generating', message: expect.any(String) });
      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'demo_generating',
            demoProgress: expect.objectContaining({ phase: 'queued' }),
          }),
        }),
      );
      expect(demoQueue.add).toHaveBeenCalledWith(
        'generate',
        { projectId: mockProjectId },
        expect.objectContaining({ attempts: expect.any(Number) }),
      );
      // 入队即返回，不在请求线程里直接生成
      expect(cloudecode.generateDemoHtmlDirect).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if status not allowed', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...planReadyProject, status: 'needs_input' });

      await expect(service.generateDemo(mockUserId, mockProjectId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if no planSummary', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...planReadyProject, planSummary: null });

      await expect(service.generateDemo(mockUserId, mockProjectId)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.generateDemo(mockUserId, mockProjectId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not owner', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...planReadyProject, userId: 'other' });

      await expect(service.generateDemo(mockUserId, mockProjectId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('executeGeneration（队列消费）', () => {
    it('生成成功 → done 进度', async () => {
      prisma.project.findUnique.mockResolvedValue({ planSummary: planReadyProject.planSummary, demoProgress: { startedAt: 't0' } });
      cloudecode.generateDemoHtmlDirect.mockResolvedValue({ success: true });

      await service.executeGeneration(mockProjectId);

      expect(cloudecode.generateDemoHtmlDirect).toHaveBeenCalled();
      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ demoProgress: expect.objectContaining({ phase: 'done', percent: 100 }) }) }),
      );
    });

    it('生成失败 → 抛错（交 BullMQ 重试）', async () => {
      prisma.project.findUnique.mockResolvedValue({ planSummary: {}, demoProgress: null });
      cloudecode.generateDemoHtmlDirect.mockResolvedValue({ success: false, rawError: 'API error' });

      await expect(service.executeGeneration(mockProjectId)).rejects.toThrow('API error');
    });
  });

  describe('onGenerationError', () => {
    it('还会重试 → generating 重试提示，不置 demo_failed', async () => {
      prisma.project.findUnique.mockResolvedValue({ demoProgress: null });

      await service.onGenerationError(mockProjectId, true, 2);

      const updatedData = prisma.project.update.mock.calls.map((c: any) => c[0].data);
      expect(updatedData.some((d: any) => d.status === 'demo_failed')).toBe(false);
      expect(updatedData.some((d: any) => d.demoProgress?.phase === 'generating')).toBe(true);
    });

    it('终态失败 → 置 demo_failed', async () => {
      prisma.project.findUnique.mockResolvedValue({ demoProgress: null });

      await service.onGenerationError(mockProjectId, false, 3);

      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'demo_failed' }) }),
      );
    });
  });

  describe('generateDemoInternal', () => {
    it('should skip userId check and generate directly', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: mockProjectId,
        status: 'plan_ready',
        planSummary: { summary: 'test' },
      });

      const result = await service.generateDemoInternal(mockProjectId);

      expect(result).toMatchObject({ status: 'demo_generating' });
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.generateDemoInternal(mockProjectId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('saveDemoHtml', () => {
    it('should save HTML and set status to demo_ready', async () => {
      await service.saveDemoHtml(mockProjectId, '<html>new</html>');

      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            demoHtml: '<html>new</html>',
            status: 'demo_ready',
          }),
        }),
      );
    });
  });
});
