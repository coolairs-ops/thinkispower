import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PipelineService } from './pipeline.service';
import { TaskService } from '../../modules/task/task.service';
import { CloudecodeClient } from '../cloudecode/cloudecode.client';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';
import { HtmlValidatorService } from '../../services/html-validator.service';
import { ErrorMatcherService } from '../../services/error-matcher.service';
import { HtmlModuleExtractorService } from '../../services/html-module-extractor.service';
import { DemoSnapshotService } from '../../modules/demo-snapshot/demo-snapshot.service';
import { DeploymentService } from '../../modules/deployment/deployment.service';

describe('PipelineService', () => {
  let service: PipelineService;
  let taskService: TaskService;
  let cloudecode: CloudecodeClient;
  let eventEmitter: EventEmitter2;
  let validator: HtmlValidatorService;
  let demoSnapshot: DemoSnapshotService;

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockTaskService = {
    getPendingTasks: jest.fn(),
    findById: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockCloudecode = {
    executeTask: jest.fn(),
  };

  const mockPrismaService = {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    demoSnapshot: {
      findFirst: jest.fn(),
    },
    decisionLog: {
      create: jest.fn(),
    },
  };

  const mockValidator = {
    validateStructure: jest.fn(),
    checkRegression: jest.fn(),
    validateAcceptanceCriteria: jest.fn(),
  };

  const mockErrorMatcher = {
    matchError: jest.fn(),
    recordError: jest.fn(),
    buildFixPrompt: jest.fn(),
  };

  const mockHtmlExtractor = {
    extractRenderContent: jest.fn(),
  };

  const mockDemoSnapshotService = {
    rollback: jest.fn(),
  };

  const mockBuildService = {
    uploadArtifact: jest.fn(),
    getLatestBuild: jest.fn(),
  };

  const mockDeploymentService = {
    deploy: jest.fn(),
  };

  const pendingTask = {
    id: 'task-1',
    projectId: 'project-1',
    type: 'frontend',
    title: '修改页面',
    description: '修改内容',
    inputPayload: { moduleKey: 'dashboard', acceptanceCriteria: ['标准1'] },
    moduleId: null,
    priority: 100,
    status: 'pending',
    dependencies: null,
    resultPayload: null,
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineService,
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: TaskService, useValue: mockTaskService },
        { provide: CloudecodeClient, useValue: mockCloudecode },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HtmlValidatorService, useValue: mockValidator },
        { provide: ErrorMatcherService, useValue: mockErrorMatcher },
        { provide: HtmlModuleExtractorService, useValue: mockHtmlExtractor },
        { provide: BuildService, useValue: mockBuildService },
        { provide: DemoSnapshotService, useValue: mockDemoSnapshotService },
        { provide: DeploymentService, useValue: mockDeploymentService },
      ],
    }).compile();

    service = module.get<PipelineService>(PipelineService);
    taskService = module.get<TaskService>(TaskService);
    cloudecode = module.get<CloudecodeClient>(CloudecodeClient);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    validator = module.get<HtmlValidatorService>(HtmlValidatorService);
    demoSnapshot = module.get<DemoSnapshotService>(DemoSnapshotService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleTasksCreated', () => {
    beforeEach(() => {
      // Default: findById returns the pending task (needed by runValidations)
      mockTaskService.findById.mockResolvedValue(pendingTask);
    });

    it('should skip when no pending tasks', async () => {
      mockTaskService.getPendingTasks.mockResolvedValue([]);

      await service['handleTasksCreated']({
        projectId: 'project-1',
        feedbackId: 'feedback-1',
        taskIds: [],
      });

      expect(mockTaskService.getPendingTasks).toHaveBeenCalledWith('project-1');
      expect(mockCloudecode.executeTask).not.toHaveBeenCalled();
    });

    it('should execute pending task and emit completion', async () => {
      mockTaskService.getPendingTasks.mockResolvedValue([pendingTask]);
      mockCloudecode.executeTask.mockResolvedValue({
        success: true,
        summary: '完成',
        changedFiles: ['demo.html'],
      });
      mockPrismaService.project.findUnique.mockResolvedValue({
        demoHtml: '<html>updated</html>',
      });
      mockValidator.validateStructure.mockReturnValue({ passed: true, errors: [] });
      mockValidator.checkRegression.mockReturnValue({ passed: true, changedModules: [] });
      mockValidator.validateAcceptanceCriteria.mockResolvedValue({
        passed: true,
        criteriaResults: [],
      });

      await service['handleTasksCreated']({
        projectId: 'project-1',
        feedbackId: 'feedback-1',
        taskIds: ['task-1'],
      });

      expect(mockCloudecode.executeTask).toHaveBeenCalledWith('task-1');
      expect(mockTaskService.updateStatus).toHaveBeenCalledWith('task-1', 'completed', expect.any(Object));
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'tasks.completed',
        expect.objectContaining({
          projectId: 'project-1',
          feedbackId: 'feedback-1',
        }),
      );
    });

    it('should retry on validation failure and rollback', async () => {
      mockTaskService.getPendingTasks.mockResolvedValue([pendingTask]);
      mockCloudecode.executeTask.mockResolvedValue({
        success: true,
        summary: '需修复',
        changedFiles: ['demo.html'],
      });
      mockPrismaService.project.findUnique.mockResolvedValue({
        demoHtml: '<html>invalid</html>',
      });
      mockPrismaService.demoSnapshot.findFirst.mockResolvedValue({ id: 'snap-1' });

      // First attempt fails validation
      mockValidator.validateStructure.mockReturnValueOnce({
        passed: false,
        errors: ['目标模块 dashboard 的 render() 内容丢失'],
      });
      // Second attempt succeeds
      mockValidator.validateStructure.mockReturnValueOnce({ passed: true, errors: [] });

      mockValidator.checkRegression.mockReturnValue({ passed: true, changedModules: [] });
      mockValidator.validateAcceptanceCriteria.mockResolvedValue({
        passed: true,
        criteriaResults: [],
      });
      mockErrorMatcher.matchError.mockResolvedValue(null);
      mockErrorMatcher.recordError.mockResolvedValue(undefined);

      await service['handleTasksCreated']({
        projectId: 'project-1',
        feedbackId: 'feedback-1',
        taskIds: ['task-1'],
      });

      // executeTask called twice: first attempt fails validation, second succeeds
      expect(mockCloudecode.executeTask).toHaveBeenCalledTimes(2);
      expect(mockDemoSnapshotService.rollback).toHaveBeenCalledWith('project-1', 'snap-1');
    });

    it('should handle cloudecode execution failure', async () => {
      mockTaskService.getPendingTasks.mockResolvedValue([pendingTask]);
      // executeTask fails, exhausting retries (4 attempts × backoff 1+2+4 = 7s expected)
      mockCloudecode.executeTask.mockResolvedValue({
        success: false,
        rawError: 'DeepSeek API error',
      });

      await service['handleTasksCreated']({
        projectId: 'project-1',
        feedbackId: 'feedback-1',
        taskIds: ['task-1'],
      });

      // Should attempt 4 times (initial + 3 retries)
      expect(mockCloudecode.executeTask).toHaveBeenCalledTimes(4);
      expect(mockTaskService.updateStatus).toHaveBeenLastCalledWith('task-1', 'failed', expect.any(Object));
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('task.failed', expect.any(Object));
    }, 30000);
  });
});
