import { DeployPipelineService } from './deploy-pipeline.service';
import { PrismaService } from '../database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';

// Mock child_process — use jest.fn() inline to avoid hoisting issues
jest.mock('child_process', () => ({ execSync: jest.fn(), exec: jest.fn() }));

// Mock fs inline to avoid hoisting issue
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Mock @prisma/client to avoid native module loading
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({})),
}));

const getMockExecSync = () => require('child_process').execSync;
const getMockFs = () => require('fs');

// Mock fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('DeployPipelineService', () => {
  let service: DeployPipelineService;

  const mockPrisma = {
    project: { findUnique: jest.fn(), update: jest.fn() },
    build: { findFirst: jest.fn(), create: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeployPipelineService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DeployPipelineService>(DeployPipelineService);
  });

  describe('dockerAvailable', () => {
    it('应检测Docker守护进程可用', () => {
      getMockExecSync().mockReturnValue(Buffer.from('Server: Docker Engine...'));
      expect(service['dockerAvailable']()).toBe(true);
    });

    it('应检测Docker守护进程不可用', () => {
      getMockExecSync().mockImplementation(() => { throw new Error('not found'); });
      expect(service['dockerAvailable']()).toBe(false);
    });
  });

  describe('build', () => {
    it('目录不存在返回失败', async () => {
      getMockFs().existsSync.mockReturnValue(false);
      const r = await service.build('del-1', 'proj-1');
      expect(r.success).toBe(false);
      expect(r.error).toContain('不存在');
    });

    it('Docker不可用返回失败', async () => {
      getMockFs().existsSync.mockReturnValue(true);
      getMockExecSync().mockImplementation((cmd: string) => {
        if (cmd.includes('docker info')) throw new Error('not running');
        return Buffer.from('');
      });
      const r = await service.build('del-1', 'proj-1');
      expect(r.success).toBe(false);
      expect(r.error).toContain('Docker daemon');
    });

    it('构建成功返回imageTag', async () => {
      getMockFs().existsSync.mockImplementation((p: string) => !p.includes('files.txt'));
      getMockExecSync().mockReturnValue('Successfully tagged think-is-power-app-proj-1');
      const r = await service.build('del-1', 'proj-1');
      expect(r.success).toBe(true);
      expect(r.imageTag).toContain('think-is-power-app-');
    });

    it('构建失败返回错误', async () => {
      getMockFs().existsSync.mockImplementation((p: string) => !p.includes('files.txt'));
      getMockExecSync().mockImplementation((cmd: string) => {
        if (cmd.includes('docker info')) return Buffer.from('');
        throw Object.assign(new Error('build failed'), { stderr: 'COPY failed: file not found' });
      });
      const r = await service.build('del-1', 'proj-1');
      expect(r.success).toBe(false);
      expect(r.error).toContain('file not found');
    });
  });

  describe('deploy', () => {
    it('目录不存在返回失败', async () => {
      getMockFs().existsSync.mockReturnValue(false);
      const r = await service.deploy('del-1', 'proj-1');
      expect(r.status).toBe('deploy_failed');
    });

    it('Docker不可用降级static_only', async () => {
      getMockFs().existsSync.mockReturnValue(true);
      getMockExecSync().mockImplementation(() => { throw new Error('no docker'); });
      const r = await service.deploy('del-1', 'proj-1');
      expect(r.status).toBe('static_only');
    });
  });

  describe('findFreePort', () => {
    it('应返回30050-30150范围内的端口', async () => {
      getMockExecSync().mockImplementation((cmd: string) => {
        if (cmd.includes('nc -z')) throw new Error('connection refused');
        if (cmd.includes('ss -tlnp')) throw new Error('no match');
        return Buffer.from('');
      });
      const port = await service['findFreePort']();
      expect(port).toBeGreaterThanOrEqual(30050);
      expect(port).toBeLessThanOrEqual(30150);
    });
  });

  describe('checkHealth', () => {
    it('健康检查成功', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      const ok = await service['checkHealth'](3000);
      expect(ok).toBe(true);
    });

    it('404也算容器运行', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      const ok = await service['checkHealth'](3000);
      expect(ok).toBe(true);
    });

    it('连接拒绝返回false', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const ok = await service['checkHealth'](3000);
      expect(ok).toBe(false);
    });
  });

  describe('extractPorts', () => {
    it('从docker-compose提取端口', () => {
      const compose = `
services:
  frontend:
    ports:
      - "8080:80"
  backend:
    ports:
      - "3000:3000"
`;
      getMockFs().readFileSync.mockReturnValue(compose);
      const ports = service['extractPorts']('/fake/compose.yml');
      expect(ports['frontend']).toBe(8080);
      expect(ports['backend']).toBe(3000);
    });

    it('无效文件返回空', () => {
      getMockFs().readFileSync.mockImplementation(() => { throw new Error('not found'); });
      const ports = service['extractPorts']('/nonexistent');
      expect(Object.keys(ports)).toHaveLength(0);
    });
  });
});
