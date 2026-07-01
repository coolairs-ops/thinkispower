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

      const result = await service.getDelivery(mockUserId, null, mockProjectId);
      expect(result.status).toBe('completed');
      expect(result.productionUrl).toBe('http://example.com');
      expect(result.isPro).toBe(true);
      expect(result.consoleLogin).toBeNull(); // 非若依项目无应用账号引导
    });

    it('若依项目 → 带出应用业务登录账号', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: mockProjectId, userId: mockUserId, status: 'completed', productionUrl: 'http://127.0.0.1:8089',
        deliveryOptions: {}, user: { plan: 'free' },
        backendRuntime: { kind: 'ruoyi', initialUsers: [{ userName: 'proj_u1', password: '123456', role: '管理员' }] },
      });
      const result = await service.getDelivery(mockUserId, null, mockProjectId);
      expect(result.consoleLogin).toMatchObject({
        username: 'ceshi',
        password: 'ceshi123',
        actualUsername: 'proj_u1',
        hasScopedAccount: true,
      });
      expect(result.consoleLogin!.note).toContain('业务系统');
    });

    it('若依项目但无 initialUsers(早期置备) → hasScopedAccount=false + 重新交付提示', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: mockProjectId, userId: mockUserId, status: 'completed', productionUrl: 'http://127.0.0.1:8089',
        deliveryOptions: {}, user: { plan: 'free' },
        backendRuntime: { kind: 'ruoyi' },
      });
      const result = await service.getDelivery(mockUserId, null, mockProjectId);
      expect(result.consoleLogin).toMatchObject({ hasScopedAccount: false, username: null });
    });

    it('should throw NotFoundException for non-existent project', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(service.getDelivery(mockUserId, null, 'bad-id')).rejects.toThrow('项目不存在');
    });

    it('should throw ForbiddenException for unauthorized access', async () => {
      prisma.project.findUnique.mockResolvedValue({ userId: 'other-user', user: { plan: 'free' } });
      await expect(service.getDelivery(mockUserId, null, mockProjectId)).rejects.toThrow('无权访问');
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
