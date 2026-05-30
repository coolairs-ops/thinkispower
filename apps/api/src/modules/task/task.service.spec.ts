import { Test, TestingModule } from '@nestjs/testing';
import { TaskService } from './task.service';
import { PrismaService } from '../../database/prisma.service';

describe('TaskService', () => {
  let service: TaskService;
  let prisma: any;

  const mockTask = {
    id: 'task-1',
    projectId: 'project-1',
    moduleId: null,
    type: 'frontend',
    title: '实现登录页面',
    description: '需要完成登录页面的 UI 和交互',
    priority: 100,
    status: 'pending',
    inputPayload: null,
    resultPayload: null,
    errorMessage: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      task: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a task with default priority', async () => {
      prisma.task.create.mockResolvedValue(mockTask);

      const result = await service.create({
        projectId: 'project-1',
        type: 'frontend',
        title: '实现登录页面',
        description: '需要完成登录页面的 UI 和交互',
      });

      expect(prisma.task.create).toHaveBeenCalledWith({
        data: {
          projectId: 'project-1',
          moduleId: null,
          type: 'frontend',
          title: '实现登录页面',
          description: '需要完成登录页面的 UI 和交互',
          priority: 100,
          inputPayload: undefined,
        },
      });
      expect(result).toEqual(mockTask);
    });

    it('should create a task with custom priority and moduleId', async () => {
      prisma.task.create.mockResolvedValue({ ...mockTask, moduleId: 'mod-1', priority: 50 });

      const result = await service.create({
        projectId: 'project-1',
        moduleId: 'mod-1',
        type: 'backend',
        title: '写API',
        description: '实现用户接口',
        priority: 50,
        inputPayload: { key: 'val' },
      });

      expect(prisma.task.create).toHaveBeenCalledWith({
        data: {
          projectId: 'project-1',
          moduleId: 'mod-1',
          type: 'backend',
          title: '写API',
          description: '实现用户接口',
          priority: 50,
          inputPayload: { key: 'val' },
        },
      });
      expect(result.moduleId).toBe('mod-1');
    });
  });

  describe('findById', () => {
    it('should return task by id', async () => {
      prisma.task.findUnique.mockResolvedValue(mockTask);

      const result = await service.findById('task-1');

      expect(prisma.task.findUnique).toHaveBeenCalledWith({ where: { id: 'task-1' } });
      expect(result).toEqual(mockTask);
    });

    it('should return null if not found', async () => {
      prisma.task.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByProject', () => {
    it('should return tasks ordered by priority and creation date', async () => {
      prisma.task.findMany.mockResolvedValue([mockTask]);

      const result = await service.findByProject('project-1');

      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { projectId: 'project-1' },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });
      expect(result).toHaveLength(1);
    });

    it('should return empty array for project with no tasks', async () => {
      prisma.task.findMany.mockResolvedValue([]);

      const result = await service.findByProject('project-empty');

      expect(result).toEqual([]);
    });
  });

  describe('getPendingTasks', () => {
    it('should return only pending tasks', async () => {
      prisma.task.findMany.mockResolvedValue([mockTask]);

      const result = await service.getPendingTasks('project-1');

      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { projectId: 'project-1', status: 'pending' },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no pending tasks', async () => {
      prisma.task.findMany.mockResolvedValue([]);

      const result = await service.getPendingTasks('project-1');

      expect(result).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('should update task status', async () => {
      prisma.task.update.mockResolvedValue({ ...mockTask, status: 'running' });

      const result = await service.updateStatus('task-1', 'running');

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'running' },
      });
      expect(result.status).toBe('running');
    });

    it('should include resultPayload when provided', async () => {
      const payload = { url: 'http://example.com' };
      prisma.task.update.mockResolvedValue({ ...mockTask, status: 'completed', resultPayload: payload });

      const result = await service.updateStatus('task-1', 'completed', { resultPayload: payload });

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'completed', resultPayload: payload },
      });
      expect(result.resultPayload).toEqual(payload);
    });

    it('should include errorMessage when provided', async () => {
      prisma.task.update.mockResolvedValue({ ...mockTask, status: 'failed', errorMessage: '出错了' });

      const result = await service.updateStatus('task-1', 'failed', { errorMessage: '出错了' });

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'failed', errorMessage: '出错了' },
      });
      expect(result.errorMessage).toBe('出错了');
    });
  });
});
