import { Test, TestingModule } from '@nestjs/testing';
import { SensorService } from './sensor.service';
import { L1StaticSensor } from './l1-static.sensor';
import { L2RuntimeSensor } from './l2-runtime.sensor';
import { L3SemanticSensor } from './l3-semantic.sensor';
import { PrismaService } from '../database/prisma.service';

describe('SensorService', () => {
  let service: SensorService;

  const mockReport = (layer: number, score: number, passed: boolean) => ({
    sensorName: `L${layer}`,
    layer,
    passed,
    score,
    checks: [
      { name: `check-${layer}`, passed, score, weight: 25, detail: 'test' },
      passed
        ? { name: `check-${layer}-ok`, passed: true, score: 100, weight: 25 }
        : { name: `check-${layer}-fail`, passed: false, score: 0, weight: 30, detail: 'critical failure' },
    ],
  });

  const mockL1 = { run: jest.fn() };
  const mockL2 = { run: jest.fn() };
  const mockL3 = { run: jest.fn() };
  const mockPrisma = {
    project: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.project.findUnique.mockResolvedValue({
      demoHtml: '<html><body>Hello</body></html>',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SensorService,
        { provide: L1StaticSensor, useValue: mockL1 },
        { provide: L2RuntimeSensor, useValue: mockL2 },
        { provide: L3SemanticSensor, useValue: mockL3 },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SensorService>(SensorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should fuse three layers with correct weights', async () => {
    mockL1.run.mockResolvedValue(mockReport(1, 80, true));
    mockL2.run.mockResolvedValue(mockReport(2, 90, true));
    mockL3.run.mockResolvedValue(mockReport(3, 70, true));

    const report = await service.runAll('project-1');

    // L1=80×0.3 + L2=90×0.3 + L3=70×0.4 = 24 + 27 + 28 = 79
    expect(report.overallScore).toBe(79);
    expect(report.layer1Score).toBe(80);
    expect(report.layer2Score).toBe(90);
    expect(report.layer3Score).toBe(70);
    expect(report.passed).toBe(true);
    expect(report.stopIteration).toBe(false);
  });

  it('should set stopIteration=true when critical check fails', async () => {
    mockL1.run.mockResolvedValue(mockReport(1, 30, false));
    mockL2.run.mockResolvedValue(mockReport(2, 90, true));
    mockL3.run.mockResolvedValue(mockReport(3, 70, true));

    const report = await service.runAll('project-1');

    expect(report.stopIteration).toBe(true);
    expect(report.passed).toBe(false);
  });

  it('should handle missing layers gracefully', async () => {
    mockL1.run.mockResolvedValue(mockReport(1, 80, true));
    mockL2.run.mockResolvedValue(mockReport(2, 90, true));
    mockL3.run.mockRejectedValue(new Error('AI service down'));

    const report = await service.runAll('project-1');

    // L3 failed → caught by try/catch, L1+L2 reweighted to 50/50
    expect(report.layer3Score).toBe(0);
    expect(report.reports.filter(r => r.layer === 3).length).toBe(0);
    expect(report.overallScore).toBe(85); // (80*0.5 + 90*0.5)
  });

  it('should run L2 sensor on platform-level without projectId', async () => {
    mockL2.run.mockResolvedValue(mockReport(2, 100, true));

    const report = await service.runAll();

    expect(report.overallScore).toBe(100);
    expect(mockL2.run).toHaveBeenCalledWith();
  });
});
