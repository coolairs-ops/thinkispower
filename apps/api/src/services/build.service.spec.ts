import { Test, TestingModule } from '@nestjs/testing';
import { BuildService } from './build.service';
import { PrismaService } from '../database/prisma.service';

describe('BuildService', () => {
  let service: BuildService;
  let prisma: PrismaService;

  const mockBuild = {
    id: 'build-1',
    projectId: 'project-1',
    version: 1,
    status: 'created',
    commitHash: null,
    artifactUrl: null,
    demoUrl: null,
    productionUrl: null,
    sourceZipUrl: null,
    packageZipUrl: null,
    repositoryUrl: null,
    databaseSchemaUrl: null,
    deploymentConfigUrl: null,
    readmeUrl: null,
    envExampleUrl: null,
    testReport: null,
    createdAt: new Date(),
  };

  const mockPrismaService = {
    build: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<BuildService>(BuildService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createBuild', () => {
    it('should create a build with version 1 when no previous build exists', async () => {
      mockPrismaService.build.findFirst.mockResolvedValue(null);
      mockPrismaService.build.create.mockResolvedValue(mockBuild);

      const result = await service.createBuild('project-1', 'source');

      expect(result).toEqual(mockBuild);
      expect(mockPrismaService.build.create).toHaveBeenCalledWith({
        data: { projectId: 'project-1', version: 1, status: 'created' },
      });
    });

    it('should increment version when previous build exists', async () => {
      mockPrismaService.build.findFirst.mockResolvedValue({ version: 3 });
      mockPrismaService.build.create.mockResolvedValue({ ...mockBuild, version: 4 });

      const result = await service.createBuild('project-1', 'source');

      expect(result.version).toBe(4);
      expect(mockPrismaService.build.create).toHaveBeenCalledWith({
        data: { projectId: 'project-1', version: 4, status: 'created' },
      });
    });
  });

  describe('updateBuildArtifact', () => {
    it('should update sourceZipUrl for source export type', async () => {
      await service.updateBuildArtifact('build-1', 'source', 'https://example.com/source.zip');

      expect(mockPrismaService.build.update).toHaveBeenCalledWith({
        where: { id: 'build-1' },
        data: { sourceZipUrl: 'https://example.com/source.zip' },
      });
    });

    it('should update repositoryUrl for repository export type', async () => {
      await service.updateBuildArtifact('build-1', 'repository', 'https://github.com/org/repo');

      expect(mockPrismaService.build.update).toHaveBeenCalledWith({
        where: { id: 'build-1' },
        data: { repositoryUrl: 'https://github.com/org/repo' },
      });
    });

    it('should update databaseSchemaUrl for database export type', async () => {
      await service.updateBuildArtifact('build-1', 'database', 'https://example.com/schema.sql');

      expect(mockPrismaService.build.update).toHaveBeenCalledWith({
        where: { id: 'build-1' },
        data: { databaseSchemaUrl: 'https://example.com/schema.sql' },
      });
    });

    it('should update deploymentConfigUrl for deployment export type', async () => {
      await service.updateBuildArtifact('build-1', 'deployment', 'https://example.com/docker-compose.yml');

      expect(mockPrismaService.build.update).toHaveBeenCalledWith({
        where: { id: 'build-1' },
        data: { deploymentConfigUrl: 'https://example.com/docker-compose.yml' },
      });
    });

    it('should warn and skip for unknown export type', async () => {
      await service.updateBuildArtifact('build-1', 'unknown', 'https://example.com/x');

      expect(mockPrismaService.build.update).not.toHaveBeenCalled();
    });
  });

  describe('updateBuildStatus', () => {
    it('should update build status', async () => {
      await service.updateBuildStatus('build-1', 'success');

      expect(mockPrismaService.build.update).toHaveBeenCalledWith({
        where: { id: 'build-1' },
        data: { status: 'success' },
      });
    });
  });

  describe('getLatestBuild', () => {
    it('should return the latest build for a project', async () => {
      mockPrismaService.build.findFirst.mockResolvedValue(mockBuild);

      const result = await service.getLatestBuild('project-1');

      expect(result).toEqual(mockBuild);
      expect(mockPrismaService.build.findFirst).toHaveBeenCalledWith({
        where: { projectId: 'project-1' },
        orderBy: { version: 'desc' },
      });
    });

    it('should return null when no builds exist', async () => {
      mockPrismaService.build.findFirst.mockResolvedValue(null);

      const result = await service.getLatestBuild('project-1');

      expect(result).toBeNull();
    });
  });

  describe('findByProject', () => {
    it('should return all builds for a project ordered by version desc', async () => {
      mockPrismaService.build.findMany.mockResolvedValue([mockBuild]);

      const result = await service.findByProject('project-1');

      expect(result).toHaveLength(1);
      expect(mockPrismaService.build.findMany).toHaveBeenCalledWith({
        where: { projectId: 'project-1' },
        orderBy: { version: 'desc' },
        select: expect.objectContaining({ id: true, version: true, status: true }),
      });
    });
  });
});
