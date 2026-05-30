import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FeedbackService } from './feedback.service';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { EVENTS } from '../../events/event-types';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let prisma: any;
  let eventEmitter: any;
  let statusMapper: any;

  const mockUserId = 'user-1';
  const mockProjectId = 'project-1';
  const mockFeedbackId = 'fb-1';

  const mockProject = { id: mockProjectId, userId: mockUserId, status: 'demo_ready' };
  const mockFeedback = {
    id: mockFeedbackId,
    projectId: mockProjectId,
    moduleKey: 'customer-list',
    elementPath: 'add-btn',
    comment: '这里需要一个导出按钮',
    status: 'new',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      project: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      feedbackItem: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    eventEmitter = { emit: jest.fn() };
    statusMapper = {
      mapProjectStatusToPublicLabel: jest.fn().mockReturnValue('某个状态'),
      assertValidTransition: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: prisma },
        { provide: StatusMapperService, useValue: statusMapper },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return feedback items for the project', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
      prisma.feedbackItem.findMany.mockResolvedValue([mockFeedback]);

      const result = await service.findAll(mockUserId, mockProjectId);

      expect(result).toHaveLength(1);
      expect(result[0].comment).toBe('这里需要一个导出按钮');
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.findAll(mockUserId, mockProjectId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not owner', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, userId: 'other' });

      await expect(service.findAll(mockUserId, mockProjectId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create', () => {
    it('should create feedback and emit event', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
      prisma.feedbackItem.create.mockResolvedValue(mockFeedback);

      const result = await service.create(mockUserId, mockProjectId, {
        moduleKey: 'customer-list',
        elementPath: 'add-btn',
        comment: '这里需要一个导出按钮',
      });

      expect(result.comment).toBe('这里需要一个导出按钮');
      expect(eventEmitter.emit).toHaveBeenCalledWith(EVENTS.FEEDBACK_CREATED, {
        feedbackId: mockFeedbackId,
        projectId: mockProjectId,
        comment: '这里需要一个导出按钮',
        moduleKey: 'customer-list',
        elementPath: 'add-btn',
      });
    });

    it('should update project status to awaiting_demo_feedback when demo_ready', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
      prisma.feedbackItem.create.mockResolvedValue(mockFeedback);

      await service.create(mockUserId, mockProjectId, { comment: '修改一下' });

      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'awaiting_demo_feedback' }),
        }),
      );
    });

    it('should not update project status when not demo_ready', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, status: 'plan_ready' });
      prisma.feedbackItem.create.mockResolvedValue(mockFeedback);

      await service.create(mockUserId, mockProjectId, { comment: '修改一下' });

      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.create(mockUserId, mockProjectId, { comment: 'test' })).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not owner', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, userId: 'other' });

      await expect(service.create(mockUserId, mockProjectId, { comment: 'test' })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateStatus', () => {
    it('should update feedback status', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
      prisma.feedbackItem.findFirst.mockResolvedValue(mockFeedback);
      prisma.feedbackItem.update.mockResolvedValue({ id: mockFeedbackId, status: 'resolved' });

      const result = await service.updateStatus(mockUserId, mockProjectId, mockFeedbackId, 'resolved');

      expect(result).toEqual({ id: mockFeedbackId, status: 'resolved' });
    });

    it('should throw BadRequestException for invalid status', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
      prisma.feedbackItem.findFirst.mockResolvedValue(mockFeedback);

      await expect(
        service.updateStatus(mockUserId, mockProjectId, mockFeedbackId, 'invalid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if feedback does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
      prisma.feedbackItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStatus(mockUserId, mockProjectId, 'nonexistent', 'resolved'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('handleFeedbackTasksCompleted', () => {
    const completedPayload = { projectId: mockProjectId, feedbackId: mockFeedbackId };

    it('should mark feedback as resolved and return to demo_ready', async () => {
      prisma.feedbackItem.findFirst.mockResolvedValue(mockFeedback);
      prisma.project.findUnique.mockResolvedValue({ status: 'awaiting_demo_feedback' });

      await service.handleFeedbackTasksCompleted(completedPayload);

      expect(prisma.feedbackItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'resolved' } }),
      );
      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'demo_ready' }) }),
      );
    });

    it('should skip if no feedbackId in payload', async () => {
      await service.handleFeedbackTasksCompleted({ projectId: mockProjectId });

      expect(prisma.feedbackItem.findFirst).not.toHaveBeenCalled();
    });

    it('should skip if feedback not found', async () => {
      prisma.feedbackItem.findFirst.mockResolvedValue(null);

      await service.handleFeedbackTasksCompleted(completedPayload);

      expect(prisma.feedbackItem.update).not.toHaveBeenCalled();
    });
  });

  describe('handleFeedbackTaskFailed', () => {
    const failedPayload = { projectId: mockProjectId, feedbackId: mockFeedbackId, taskId: 't-1', error: 'error' };

    it('should set feedback to processing and project to failed', async () => {
      prisma.feedbackItem.findFirst.mockResolvedValue(mockFeedback);

      await service.handleFeedbackTaskFailed(failedPayload);

      expect(prisma.feedbackItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'processing' } }),
      );
      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
      );
    });

    it('should skip if no feedbackId in payload', async () => {
      await service.handleFeedbackTaskFailed({ projectId: mockProjectId, taskId: 't-1', error: 'err' });

      expect(prisma.feedbackItem.findFirst).not.toHaveBeenCalled();
    });

    it('should skip if feedback not found', async () => {
      prisma.feedbackItem.findFirst.mockResolvedValue(null);

      await service.handleFeedbackTaskFailed(failedPayload);

      expect(prisma.feedbackItem.update).not.toHaveBeenCalled();
    });
  });
});
