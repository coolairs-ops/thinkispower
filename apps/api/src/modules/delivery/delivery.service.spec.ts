import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DeliveryService } from './delivery.service';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { HermesClient } from '../../integrations/hermes/hermes.client';
import { N8nClient } from '../../integrations/n8n/n8n.client';
import { CaseReviewService } from '../case-review/case-review.service';
import { ExperienceRecommendationService } from '../experience-recommendation/experience-recommendation.service';
import { DeploymentService } from '../deployment/deployment.service';
import { EVENTS } from '../../events/event-types';

describe('DeliveryService', () => {
  let service: DeliveryService;
  let prisma: any;
  let eventEmitter: any;
  let buildService: any;
  let statusMapper: any;
  let hermes: any;
  let n8n: any;
  let caseReview: any;
  let experience: any;
  let deployment: any;

  const mockUserId = 'user-1';
  const mockProjectId = 'project-1';
  const mockBuildId = 'build-1';

  const mockProject = {
    id: mockProjectId,
    userId: mockUserId,
    name: '测试项目',
    status: 'demo_ready',
    productionUrl: null,
    publicStatusLabel: '预览已准备好',
    planSummary: { summary: 'test' },
    structuredRequirement: { prd: { productName: 'Test' } },
    user: { plan: 'pro' },
    deliveryOptions: null,
  };

  const mockBuild = {
    id: mockBuildId,
    projectId: mockProjectId,
    version: 1,
    status: 'created',
    sourceZipUrl: null,
    packageZipUrl: null,
    repositoryUrl: null,
    databaseSchemaUrl: null,
    deploymentConfigUrl: null,
    productionUrl: null,
    testReport: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      project: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      build: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue(mockBuild),
        update: jest.fn().mockResolvedValue({}),
      },
      deployment: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    eventEmitter = { emit: jest.fn() };
    buildService = {
      createBuild: jest.fn().mockResolvedValue(mockBuild),
      getLatestBuild: jest.fn().mockResolvedValue(mockBuild),
      updateBuildStatus: jest.fn().mockResolvedValue(undefined),
    };
    statusMapper = {
      assertValidTransition: jest.fn(),
      mapProjectStatusToPublicLabel: jest.fn().mockReturnValue('处理中'),
    };
    hermes = {
      handleDeliveryExport: jest.fn(),
    };
    n8n = {
      triggerDeliveryExportWorkflow: jest.fn(),
    };
    caseReview = {
      generateReview: jest.fn().mockResolvedValue({ summary: 'review done' }),
    };
    experience = {
      generateRecommendations: jest.fn().mockResolvedValue([]),
    };
    deployment = {
      deploy: jest.fn().mockResolvedValue({ deploymentId: 'dep-1', productionUrl: 'http://example.com/app' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') } },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: BuildService, useValue: buildService },
        { provide: StatusMapperService, useValue: statusMapper },
        { provide: HermesClient, useValue: hermes },
        { provide: N8nClient, useValue: n8n },
        { provide: CaseReviewService, useValue: caseReview },
        { provide: ExperienceRecommendationService, useValue: experience },
        { provide: DeploymentService, useValue: deployment },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── getDelivery ───

  describe('getDelivery', () => {
    it('should return delivery data with analysis and build', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);

      const result = await service.getDelivery(mockUserId, mockProjectId);

      expect(result).toMatchObject({
        status: 'demo_ready',
        isPro: true,
      });
      expect(result.latestBuild).toBeDefined();
      expect(result.latestBuild!.version).toBe(1);
      expect(buildService.getLatestBuild).toHaveBeenCalledWith(mockProjectId);
    });

    it('should throw NotFoundException when project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        service.getDelivery(mockUserId, mockProjectId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user is not the owner', async () => {
      prisma.project.findUnique.mockResolvedValue({
        ...mockProject,
        userId: 'other-user',
      });

      await expect(
        service.getDelivery(mockUserId, mockProjectId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should include deliveryAnalysis from structuredRequirement', async () => {
      const analysis = { completeness: 85, risks: [], recommendations: ['测试'] };
      prisma.project.findUnique.mockResolvedValue({
        ...mockProject,
        structuredRequirement: { deliveryAnalysis: analysis },
      });

      const result = await service.getDelivery(mockUserId, mockProjectId);
      expect(result.deliveryAnalysis).toEqual(analysis);
    });

    it('should return null latestBuild when no build exists', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
      buildService.getLatestBuild.mockResolvedValue(null);

      const result = await service.getDelivery(mockUserId, mockProjectId);
      expect(result.latestBuild).toBeNull();
    });
  });

  // ─── confirmDelivery ───

  describe('confirmDelivery', () => {
    const mockHermesResult = {
      taskIds: ['task-1', 'task-2'],
      analysis: { completeness: 80, risks: [], recommendations: [] },
    };

    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
      hermes.handleDeliveryExport.mockResolvedValue(mockHermesResult);
      n8n.triggerDeliveryExportWorkflow.mockResolvedValue({ success: true, runId: 'run-1' });
    });

    it('should execute full delivery pipeline with N8N', async () => {
      const result = await service.confirmDelivery(mockUserId, mockProjectId);

      expect(hermes.handleDeliveryExport).toHaveBeenCalledWith(mockProjectId);
      expect(statusMapper.assertValidTransition).toHaveBeenCalledWith('demo_ready', 'exporting');
      expect(buildService.createBuild).toHaveBeenCalledWith(mockProjectId, 'delivery');
      expect(n8n.triggerDeliveryExportWorkflow).toHaveBeenCalledWith(mockProjectId, 'full');
      expect(result).toMatchObject({
        success: true,
        status: 'exporting',
        buildId: mockBuildId,
        taskCount: 2,
      });
    });

    it('should fallback to PipelineService when N8N trigger fails', async () => {
      n8n.triggerDeliveryExportWorkflow.mockResolvedValue({ success: false });

      const result = await service.confirmDelivery(mockUserId, mockProjectId);

      expect(eventEmitter.emit).toHaveBeenCalledWith(EVENTS.TASKS_CREATED, {
        projectId: mockProjectId,
        taskIds: mockHermesResult.taskIds,
      });
      expect(result.success).toBe(true);
    });

    it('should fallback to PipelineService when N8N is unavailable', async () => {
      // Simulate N8N health check failure by making triggerDeliveryExportWorkflow reject
      n8n.triggerDeliveryExportWorkflow.mockResolvedValue({ success: false });

      const result = await service.confirmDelivery(mockUserId, mockProjectId);

      // Falls back to emitting TASKS_CREATED
      expect(eventEmitter.emit).toHaveBeenCalledWith(EVENTS.TASKS_CREATED, {
        projectId: mockProjectId,
        taskIds: mockHermesResult.taskIds,
      });
      expect(result.success).toBe(true);
      expect(result.taskCount).toBe(2);
    });

    it('should deploy directly when no tasks are generated', async () => {
      hermes.handleDeliveryExport.mockResolvedValue({
        taskIds: [],
        analysis: { completeness: 100, risks: [], recommendations: [] },
      });

      const result = await service.confirmDelivery(mockUserId, mockProjectId);

      expect(deployment.deploy).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.taskCount).toBe(0);
    });

    it('should throw NotFoundException when project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmDelivery(mockUserId, mockProjectId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user is not the owner', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, userId: 'other-user' });

      await expect(
        service.confirmDelivery(mockUserId, mockProjectId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── requestExport ───

  describe('requestExport', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
    });

    it('should return upgradeRequired for free users', async () => {
      prisma.project.findUnique.mockResolvedValue({
        ...mockProject,
        user: { plan: 'free' },
      });

      const result = await service.requestExport(mockUserId, mockProjectId, 'source');

      expect(result).toEqual({
        upgradeRequired: true,
        message: expect.any(String),
      });
    });

    it('should create build and emit event for pro users', async () => {
      const result = await service.requestExport(mockUserId, mockProjectId, 'source');

      expect(buildService.createBuild).toHaveBeenCalledWith(mockProjectId, 'source');
      expect(statusMapper.assertValidTransition).toHaveBeenCalledWith('demo_ready', 'exporting');
      expect(eventEmitter.emit).toHaveBeenCalledWith(EVENTS.DELIVERY_EXPORT_REQUESTED, {
        projectId: mockProjectId,
        buildId: mockBuildId,
        exportType: 'source',
        userId: mockUserId,
      });
      expect(result).toMatchObject({
        buildId: mockBuildId,
        status: 'processing',
      });
    });

    it('should support all export types', async () => {
      for (const exportType of ['source', 'package', 'repository', 'database', 'deployment']) {
        prisma.project.findUnique.mockResolvedValue(mockProject);
        buildService.createBuild.mockClear();
        eventEmitter.emit.mockClear();

        await service.requestExport(mockUserId, mockProjectId, exportType);

        expect(eventEmitter.emit).toHaveBeenCalledWith(
          EVENTS.DELIVERY_EXPORT_REQUESTED,
          expect.objectContaining({ exportType }),
        );
      }
    });

    it('should throw NotFoundException when project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        service.requestExport(mockUserId, mockProjectId, 'source'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── handleDeliveryTasksCompleted ───

  describe('handleDeliveryTasksCompleted', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, status: 'exporting' });
      prisma.build.findFirst.mockResolvedValue(mockBuild);
      prisma.deployment.findFirst = jest.fn().mockResolvedValue(null);
    });

    it('should deploy and mark project as completed', async () => {
      await service.handleDeliveryTasksCompleted({ projectId: mockProjectId });

      expect(deployment.deploy).toHaveBeenCalledWith(mockProjectId, mockBuildId);
      expect(statusMapper.assertValidTransition).toHaveBeenCalledWith('exporting', 'completed');
      expect(prisma.project.update).toHaveBeenCalled();
    });

    it('should skip deploy if deployment already exists', async () => {
      prisma.deployment.findFirst = jest.fn().mockResolvedValue({ id: 'dep-1', status: 'deployed' });

      await service.handleDeliveryTasksCompleted({ projectId: mockProjectId });

      // Uses existing deployment URL, doesn't call deploy()
      expect(deployment.deploy).not.toHaveBeenCalled();
    });

    it('should trigger async review and experience generation', async () => {
      await service.handleDeliveryTasksCompleted({ projectId: mockProjectId });

      // Wait for async promises to settle
      await new Promise(process.nextTick);

      expect(caseReview.generateReview).toHaveBeenCalledWith(mockProjectId);
      expect(experience.generateRecommendations).toHaveBeenCalledWith(mockProjectId);
    });

    it('should not process project not in exporting status', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, status: 'completed' });

      await service.handleDeliveryTasksCompleted({ projectId: mockProjectId });

      expect(deployment.deploy).not.toHaveBeenCalled();
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });
});
