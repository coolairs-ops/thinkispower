import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectService } from './project.service';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';

describe('ProjectService', () => {
  let service: ProjectService;
  let prisma: any;
  let statusMapper: any;

  const mockUserId = 'user-1';
  const mockProjectId = 'project-1';

  const mockProject = {
    id: mockProjectId,
    userId: mockUserId,
    name: '测试项目',
    description: '一个测试项目',
    status: 'needs_input',
    publicStatusLabel: '正在了解需求',
    appType: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deliveryOptions: { id: 'do-1' },
  };

  beforeEach(async () => {
    prisma = {
      project: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    statusMapper = {
      mapProjectStatusToPublicLabel: jest.fn().mockImplementation((s: string) => s),
      assertValidTransition: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: PrismaService, useValue: prisma },
        { provide: StatusMapperService, useValue: statusMapper },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a project with deliveryOptions', async () => {
      prisma.project.create.mockResolvedValue(mockProject);

      const result = await service.create(mockUserId, 'org-1', { name: '测试项目', description: '一个测试项目' });

      expect(prisma.project.create).toHaveBeenCalledWith({
        data: {
          userId: mockUserId,
          orgId: 'org-1',
          name: '测试项目',
          description: '一个测试项目',
          status: 'needs_input',
          publicStatusLabel: 'needs_input',
          deliveryOptions: { create: {} },
        },
        include: { deliveryOptions: true },
      });
      expect(result).toMatchObject({ id: mockProjectId, name: '测试项目', hasPlan: false });
    });

    it('should create with empty description', async () => {
      prisma.project.create.mockResolvedValue({ ...mockProject, description: '' });

      const result = await service.create(mockUserId, 'org-1', { name: '测试' });

      expect(result.description).toBe('');
    });
  });

  describe('findAll', () => {
    it('should return user projects ordered by createdAt desc', async () => {
      prisma.project.findMany.mockResolvedValue([mockProject]);

      const result = await service.findAll(mockUserId);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('should return project if user owns it', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);

      const result = await service.findOne(mockUserId, mockProjectId);

      expect(result).toMatchObject({ id: mockProjectId, name: '测试项目', hasPlan: false });
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.findOne(mockUserId, mockProjectId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not the owner', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, userId: 'other-user' });

      await expect(service.findOne(mockUserId, mockProjectId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update project fields', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject);
      prisma.project.update.mockResolvedValue({ ...mockProject, name: '新名称' });

      const result = await service.update(mockUserId, mockProjectId, { name: '新名称' });

      expect(result.name).toBe('新名称');
    });

    it('should update structuredRequirement', async () => {
      const req = { prd: { productName: 'Test' } };
      prisma.project.findUnique.mockResolvedValue(mockProject);
      prisma.project.update.mockResolvedValue({ ...mockProject, structuredRequirement: req as any });

      await service.update(mockUserId, mockProjectId, { structuredRequirement: req });

      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ structuredRequirement: req }) }),
      );
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.update(mockUserId, mockProjectId, { name: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not owner', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, userId: 'other' });

      await expect(service.update(mockUserId, mockProjectId, { name: 'x' })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('confirmPlan', () => {
    it('should transition from prd_ready to plan_ready', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, status: 'prd_ready' });
      prisma.project.update.mockResolvedValue({ ...mockProject, status: 'plan_ready' });

      const result = await service.confirmPlan(mockUserId, mockProjectId);

      expect(result.status).toBe('plan_ready');
      expect(statusMapper.mapProjectStatusToPublicLabel).toHaveBeenCalledWith('plan_ready');
    });

    it('should throw ForbiddenException if status is not prd_ready', async () => {
      prisma.project.findUnique.mockResolvedValue({ ...mockProject, status: 'needs_input' });

      await expect(service.confirmPlan(mockUserId, mockProjectId)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.confirmPlan(mockUserId, mockProjectId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProjectStatus', () => {
    it('should update status with state machine validation', async () => {
      prisma.project.findUnique.mockResolvedValue({ status: 'needs_input' });
      prisma.project.update.mockResolvedValue({});

      await service.updateProjectStatus(mockProjectId, 'clarifying');

      expect(statusMapper.assertValidTransition).toHaveBeenCalledWith('needs_input', 'clarifying');
      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'clarifying' }),
        }),
      );
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.updateProjectStatus(mockProjectId, 'completed')).rejects.toThrow(NotFoundException);
    });
  });
});
