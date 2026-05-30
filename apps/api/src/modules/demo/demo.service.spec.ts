import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DemoService } from './demo.service';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { DemoSnapshotService } from '../demo-snapshot/demo-snapshot.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { HermesClient } from '../../integrations/hermes/hermes.client';

describe('DemoService', () => {
  let service: DemoService;
  let prisma: any;
  let cloudecode: any;
  let hermes: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemoService,
        { provide: PrismaService, useValue: prisma },
        { provide: StatusMapperService, useValue: { mapProjectStatusToPublicLabel: jest.fn() } },
        { provide: DemoSnapshotService, useValue: {} },
        { provide: CloudecodeClient, useValue: cloudecode },
        { provide: HermesClient, useValue: hermes },
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

      expect(result.html).toBe('<html><body>Hello</body></html>');
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

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.getDemo(mockUserId, mockProjectId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not owner', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...baseProject, userId: 'other' });

      await expect(service.getDemo(mockUserId, mockProjectId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('generateDemo', () => {
    it('should mark as generating and trigger N8N webhook (no fallback)', async () => {
      prisma.project.findUnique.mockResolvedValue(planReadyProject);

      const result = await service.generateDemo(mockUserId, mockProjectId);

      expect(result).toMatchObject({ status: 'demo_generating', message: expect.any(String) });
      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'demo_generating' }) }),
      );

      // Let all async work drain
      await new Promise<void>(resolve => setImmediate(resolve));

      // N8N path: fetch was called, cloudecode NOT called
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/webhook/demo-generate'),
        expect.anything(),
      );
      expect(cloudecode.generateDemoHtmlDirect).not.toHaveBeenCalled();
    });

    it('should fallback to cloudecode when N8N returns non-ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      prisma.project.findUnique.mockResolvedValue(planReadyProject);
      cloudecode.generateDemoHtmlDirect.mockResolvedValue({ success: true });

      await service.generateDemo(mockUserId, mockProjectId);

      await new Promise<void>(resolve => setImmediate(resolve));
      expect(cloudecode.generateDemoHtmlDirect).toHaveBeenCalledWith(mockProjectId, planReadyProject.planSummary);
    });

    it('should set demo_failed when N8N fails and cloudecode returns failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
      prisma.project.findUnique.mockResolvedValue(planReadyProject);
      cloudecode.generateDemoHtmlDirect.mockResolvedValue({ success: false, rawError: 'API error' });

      await service.generateDemo(mockUserId, mockProjectId);

      await new Promise<void>(resolve => setImmediate(resolve));
      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'demo_failed' }) }),
      );
    });

    it('should set demo_failed when both N8N and cloudecode throw', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
      prisma.project.findUnique.mockResolvedValue(planReadyProject);
      cloudecode.generateDemoHtmlDirect.mockRejectedValue(new Error('crash'));

      await service.generateDemo(mockUserId, mockProjectId);

      await new Promise<void>(resolve => setImmediate(resolve));
      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'demo_failed' }) }),
      );
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
