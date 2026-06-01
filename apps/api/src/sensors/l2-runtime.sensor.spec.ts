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
});
