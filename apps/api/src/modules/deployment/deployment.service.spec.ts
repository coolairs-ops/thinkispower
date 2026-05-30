import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeploymentService } from './deployment.service';
import { PrismaService } from '../../database/prisma.service';
import { IDeploymentProvider, DEPLOYMENT_PROVIDERS } from './interfaces/deployment-provider.interface';

describe('DeploymentService', () => {
  let service: DeploymentService;
  let prisma: any;

  const mockProjectId = 'project-1';
  const mockBuildId = 'build-1';

  beforeEach(async () => {
    prisma = {
      project: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      deployment: {
        create: jest.fn().mockResolvedValue({ id: 'dep-1' }),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      build: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('deploy', () => {
    it('should deploy via provider and return production URL', async () => {
      const mockProvider: IDeploymentProvider = {
        getType: () => 'internal',
        isAvailable: () => true,
        deploy: jest.fn().mockResolvedValue({ success: true, url: 'http://deploy/app', provider: 'internal' }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeploymentService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') } },
          { provide: DEPLOYMENT_PROVIDERS, useValue: [mockProvider] },
        ],
      }).compile();

      service = module.get<DeploymentService>(DeploymentService);

      prisma.project.findUnique.mockResolvedValue({
        id: mockProjectId,
        demoHtml: '<html><body>Hello</body></html>',
      });

      const result = await service.deploy(mockProjectId, mockBuildId);

      expect(result).toMatchObject({
        deploymentId: 'dep-1',
        productionUrl: expect.stringContaining('deploy'),
      });
      expect(mockProvider.deploy).toHaveBeenCalled();
    });

    it('should return fallback URL when no demoHtml exists', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeploymentService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') } },
          { provide: DEPLOYMENT_PROVIDERS, useValue: [] },
        ],
      }).compile();

      service = module.get<DeploymentService>(DeploymentService);

      prisma.project.findUnique.mockResolvedValue({ id: mockProjectId, demoHtml: null });

      const result = await service.deploy(mockProjectId);

      expect(result).toMatchObject({
        deploymentId: '',
        productionUrl: expect.stringContaining('/api/deploy/'),
      });
    });

    it('should try next provider when first fails', async () => {
      const failingDeploy = jest.fn().mockRejectedValue(new Error('Provider crash'));
      const fallbackDeploy = jest.fn().mockResolvedValue({ success: true, url: 'http://fallback/app', provider: 'fallback' });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeploymentService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') } },
          {
            provide: 'DEPLOYMENT_PROVIDERS',
            useValue: [
              { getType: () => 'failing', isAvailable: () => true, deploy: failingDeploy },
              { getType: () => 'fallback', isAvailable: () => true, deploy: fallbackDeploy },
            ],
          },
        ],
      }).compile();

      service = module.get<DeploymentService>(DeploymentService);

      prisma.project.findUnique.mockResolvedValue({
        id: mockProjectId,
        demoHtml: '<html>test</html>',
      });

      const result = await service.deploy(mockProjectId);

      expect(failingDeploy).toHaveBeenCalled();
      expect(fallbackDeploy).toHaveBeenCalled();
      expect(result).toMatchObject({
        deploymentId: 'dep-1',
        productionUrl: expect.stringContaining('project-1'),
      });
    });

    it('should skip unavailable providers', async () => {
      const unavailableProvider: IDeploymentProvider = {
        getType: () => 'offline',
        isAvailable: () => false,
        deploy: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeploymentService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') } },
          { provide: DEPLOYMENT_PROVIDERS, useValue: [unavailableProvider] },
        ],
      }).compile();

      service = module.get<DeploymentService>(DeploymentService);

      prisma.project.findUnique.mockResolvedValue({
        id: mockProjectId,
        demoHtml: '<html>test</html>',
      });

      const result = await service.deploy(mockProjectId);

      expect(unavailableProvider.deploy).not.toHaveBeenCalled();
      expect(result.productionUrl).toBeTruthy();
    });
  });

  describe('without providers', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeploymentService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') } },
        ],
      }).compile();

      service = module.get<DeploymentService>(DeploymentService);
    });

    it('should return fallback productionUrl when no providers configured', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: mockProjectId,
        demoHtml: '<html>Hello</html>',
      });

      const result = await service.deploy(mockProjectId);

      expect(result).toMatchObject({
        deploymentId: 'dep-1',
        productionUrl: 'http://localhost:3001/api/deploy/project-1',
      });
    });
  });

  describe('getDeployedHtml', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeploymentService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: { get: jest.fn() } },
        ],
      }).compile();

      service = module.get<DeploymentService>(DeploymentService);
    });

    it('should return HTML from latest successful deployment', async () => {
      prisma.deployment.findFirst.mockResolvedValue({
        html: '<html>Deployed</html>',
      });

      const html = await service.getDeployedHtml(mockProjectId);
      expect(html).toBe('<html>Deployed</html>');
    });

    it('should return null when no deployment exists', async () => {
      prisma.deployment.findFirst.mockResolvedValue(null);

      const html = await service.getDeployedHtml(mockProjectId);
      expect(html).toBeNull();
    });
  });

  describe('getHistory', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeploymentService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: { get: jest.fn() } },
        ],
      }).compile();

      service = module.get<DeploymentService>(DeploymentService);
    });

    it('should return deployment history ordered by creation date', async () => {
      prisma.deployment.findMany.mockResolvedValue([
        { id: 'dep-2', status: 'deployed', provider: 'internal', createdAt: new Date('2026-05-29') },
        { id: 'dep-1', status: 'failed', provider: 'internal', createdAt: new Date('2026-05-28') },
      ]);

      const history = await service.getHistory(mockProjectId);
      expect(history).toHaveLength(2);
      expect(prisma.deployment.findMany).toHaveBeenCalledWith({
        where: { projectId: mockProjectId },
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });
    });
  });
});
