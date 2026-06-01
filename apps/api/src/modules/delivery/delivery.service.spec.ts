import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryService } from './delivery.service';
import { PrismaService } from '../../database/prisma.service';
import { BuildService } from '../../services/build.service';

describe('DeliveryService', () => {
  let service: DeliveryService;
  let prisma: any;
  let buildService: any;

  const mockUserId = 'user-1';
  const mockProjectId = 'project-1';

  beforeEach(async () => {
    prisma = { project: { findUnique: jest.fn() } };
    buildService = { getLatestBuild: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryService,
        { provide: PrismaService, useValue: prisma },
        { provide: BuildService, useValue: buildService },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  describe('getDelivery', () => {
    it('should return delivery info for project', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: mockProjectId, userId: mockUserId,
        status: 'completed', productionUrl: 'http://example.com',
        publicStatusLabel: '已完成',
        structuredRequirement: {},
        deliveryOptions: { onlineUrlEnabled: true },
        user: { plan: 'pro' },
      });

      const result = await service.getDelivery(mockUserId, mockProjectId);
      expect(result.status).toBe('completed');
      expect(result.productionUrl).toBe('http://example.com');
      expect(result.isPro).toBe(true);
    });

    it('should throw NotFoundException for non-existent project', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(service.getDelivery(mockUserId, 'bad-id')).rejects.toThrow('项目不存在');
    });

    it('should throw ForbiddenException for unauthorized access', async () => {
      prisma.project.findUnique.mockResolvedValue({ userId: 'other-user', user: { plan: 'free' } });
      await expect(service.getDelivery(mockUserId, mockProjectId)).rejects.toThrow('无权访问');
    });
  });

  describe('withTimeout', () => {
    it('should resolve if promise resolves in time', async () => {
      const result = await DeliveryService.withTimeout(Promise.resolve('ok'), 1000, 'test');
      expect(result).toBe('ok');
    });

    it('should reject if promise times out', async () => {
      const slow = new Promise(r => setTimeout(r, 500));
      await expect(DeliveryService.withTimeout(slow, 10, 'test')).rejects.toThrow('超时');
    });
  });
});
