import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { L2RuntimeSensor } from './l2-runtime.sensor';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('L2RuntimeSensor', () => {
  let sensor: L2RuntimeSensor;

  const mockPrisma = {
    $queryRaw: jest.fn(),
    task: {
      aggregate: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockConfig = {
    get: jest.fn(),
  };

  const mockEventEmitter = {
    listeners: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    mockPrisma.task.aggregate.mockResolvedValue({ _count: 10 });
    mockPrisma.task.count.mockResolvedValue(2);
    mockEventEmitter.listeners.mockReturnValue([]);
    mockConfig.get.mockImplementation((key: string, fallback: any) => fallback);

    // Mock fetch for health checks to fail gracefully
    global.fetch = jest.fn().mockRejectedValue(new Error('not available in test'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        L2RuntimeSensor,
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    sensor = module.get<L2RuntimeSensor>(L2RuntimeSensor);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(sensor).toBeDefined();
  });

  it('should return a SensorReport with layer=2', async () => {
    const report = await sensor.run('project-1');

    expect(report.sensorName).toBe('L2-运行时状态');
    expect(report.layer).toBe(2);
    expect(report.checks.length).toBeGreaterThanOrEqual(4);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it('should pass database health check when DB is responsive', async () => {
    const report = await sensor.run('project-1');
    const dbCheck = report.checks.find(c => c.name === '数据库连接');

    expect(dbCheck).toBeDefined();
    expect(dbCheck!.passed).toBe(true);
    expect(dbCheck!.detail).toContain('ms');
  });

  it('should add task health info when projectId is provided', async () => {
    const report = await sensor.run('project-1');
    const taskCheck = report.checks.find(c => c.name === '任务执行健康度');

    expect(taskCheck).toBeDefined();
  });

  it('should work without projectId (platform-wide check)', async () => {
    const report = await sensor.run();

    expect(report).toBeDefined();
    expect(report.checks.length).toBeGreaterThanOrEqual(3);

    // 没有 projectId 时不应有 task health check
    const taskCheck = report.checks.find(c => c.name === '任务执行健康度');
    expect(taskCheck).toBeUndefined();
  });

  it('MinIO 主机名解析失败（本地连不到 docker 内网名）→ 跳过、不计分、不报"不可用"', async () => {
    // undici fetch 的 DNS 失败：TypeError: fetch failed，真实错误在 err.cause.code
    const dnsErr: any = new TypeError('fetch failed');
    dnsErr.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND minio' };
    (global.fetch as jest.Mock).mockImplementation((url: string) =>
      typeof url === 'string' && url.includes('minio') ? Promise.reject(dnsErr) : Promise.reject(new Error('n/a')),
    );

    const report = await sensor.run();
    const minio = report.checks.find(c => c.name === 'MinIO 存储');
    expect(minio).toBeDefined();
    expect(minio!.passed).toBe(true);        // 不拉低 passed
    expect(minio!.weight).toBe(0);           // 不计入评分
    expect(minio!.error).toBeUndefined();    // 不报 "MinIO 不可用"
    expect(minio!.detail).toContain('本地环境');
  });

  it('MinIO 真宕机（连接被拒，非 DNS）→ 照旧计为失败', async () => {
    const refused: any = new TypeError('fetch failed');
    refused.cause = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' };
    (global.fetch as jest.Mock).mockImplementation((url: string) =>
      typeof url === 'string' && url.includes('minio') ? Promise.reject(refused) : Promise.reject(new Error('n/a')),
    );

    const report = await sensor.run();
    const minio = report.checks.find(c => c.name === 'MinIO 存储');
    expect(minio!.passed).toBe(false);
    expect(minio!.weight).toBe(20);
    expect(minio!.error).toBe('MinIO 不可用');
  });
});
