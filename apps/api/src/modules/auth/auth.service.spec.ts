import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../database/prisma.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-pw'),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: '测试用户',
    role: 'developer',
    refreshToken: 'refresh-token-mock',
    hashedPassword: 'hashed-pw',
    plan: 'free',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      organization: {
        create: jest.fn(),
      },
      membership: {
        create: jest.fn(),
      },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));

    let signCount = 0;
    jwtService = {
      sign: jest.fn().mockImplementation(() => {
        signCount++;
        return signCount === 1 ? 'access-token-mock' : 'refresh-token-mock';
      }),
      verify: jest.fn().mockReturnValue({ sub: 'user-1', type: 'refresh' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user and return tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockUser);
      prisma.organization.create.mockResolvedValue({ id: 'org-1', name: '测试用户 的空间' });
      prisma.membership.create.mockResolvedValue({ id: 'membership-1' });
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.register('test@example.com', '测试用户', 'password123');

      expect(result.accessToken).toBe('access-token-mock');
      expect(result.refreshToken).toBe('refresh-token-mock');
      expect(result.user.email).toBe('test@example.com');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'test@example.com', name: '测试用户', hashedPassword: 'hashed-pw' },
      });
      expect(prisma.organization.create).toHaveBeenCalledWith({
        data: { name: '测试用户 的空间', slug: 'user-user-1', plan: 'free' },
      });
      expect(prisma.membership.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', orgId: 'org-1', role: 'owner' },
      });
    });

    it('should throw on duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(service.register('test@example.com', '测试用户', 'password123'))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return tokens on valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.login('test@example.com', 'password123');

      expect(result.accessToken).toBe('access-token-mock');
      expect(result.refreshToken).toBe('refresh-token-mock');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('wrong@example.com', 'x')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if password is wrong', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.login('test@example.com', 'wrong')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('should return new tokens on valid refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.refresh('refresh-token-mock');

      expect(result.accessToken).toBe('access-token-mock');
      expect(result.refreshToken).toBe('refresh-token-mock');
    });

    it('should throw on missing token', async () => {
      await expect(service.refresh('')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getProfile', () => {
    it('should return user profile with role', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile('user-1');
      expect(result).toBeDefined();
      expect(result!.email).toBe('test@example.com');
    });

    it('should return null if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getProfile('nonexistent');
      expect(result).toBeNull();
    });
  });
});
