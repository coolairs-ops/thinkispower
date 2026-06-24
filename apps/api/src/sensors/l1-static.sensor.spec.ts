import { Test, TestingModule } from '@nestjs/testing';
import { L1StaticSensor } from './l1-static.sensor';
import { QualityGateService } from '../services/quality-gate.service';

describe('L1StaticSensor', () => {
  let sensor: L1StaticSensor;

  const mockQualityGate = {
    runAllChecks: jest.fn(),
    detectFeatures: jest.fn(),
  };

  const validHtml = `<!DOCTYPE html><html><head></head><body>
    <section data-module-key="dashboard" data-element-path="main">
      <h1>Dashboard</h1>
      <button onclick="navigate('detail')">查看</button>
    </section>
    <section data-module-key="detail" data-element-path="detail-page">
      <p>Detail</p>
    </section>
  </body></html>`;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        L1StaticSensor,
        { provide: QualityGateService, useValue: mockQualityGate },
      ],
    }).compile();

    sensor = module.get<L1StaticSensor>(L1StaticSensor);

    mockQualityGate.runAllChecks.mockResolvedValue({
      passed: true,
      score: 100,
      checks: [
        { name: 'HTML结构完整性', passed: true, detail: '完整' }, // 真名（L1 sensor 原来错查 'HTML结构' → 恒 0 的 bug 已修）
        { name: '批注标注', passed: true, detail: '2个' },
        { name: '导航交互', passed: true, detail: '有' },
        { name: '无残留待办内容', passed: true, detail: '已清理' },
      ],
    });
  });

  it('should be defined', () => {
    expect(sensor).toBeDefined();
  });

  it('should return a SensorReport with layer=1', async () => {
    const report = await sensor.run('project-1', validHtml);

    expect(report.sensorName).toBe('L1-静态分析');
    expect(report.layer).toBe(1);
    expect(report.checks.length).toBeGreaterThanOrEqual(5);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it('should detect unclosed script tags', async () => {
    const htmlWithBadScript = validHtml + '<script>alert("test")';

    const report = await sensor.run('project-1', htmlWithBadScript);
    const scriptCheck = report.checks.find(c => c.name === '脚本完整性');

    expect(scriptCheck).toBeDefined();
    expect(scriptCheck!.passed).toBe(false);
  });

  it('should flag oversized HTML', async () => {
    const hugeHtml = validHtml + 'x'.repeat(200_000);

    const report = await sensor.run('project-1', hugeHtml);
    const sizeCheck = report.checks.find(c => c.name === 'HTML体积');

    expect(sizeCheck).toBeDefined();
    expect(sizeCheck!.passed).toBe(false);
    expect(sizeCheck!.detail).toContain('KB');
  });

  it('should pass for complete and clean HTML', async () => {
    const report = await sensor.run('project-1', validHtml);

    expect(report.score).toBeGreaterThanOrEqual(70);
  });

  it('HTML结构 检查解析正确（修名字 bug：质量门 HTML结构完整性 passed → L1 此项 passed/100）', async () => {
    const report = await sensor.run('project-1', validHtml);
    const htmlStruct = report.checks.find((c) => c.name === 'HTML结构');
    expect(htmlStruct?.passed).toBe(true); // 原来恒 false（查错名）
    expect(htmlStruct?.score).toBe(100);
  });

  it('各检查权重总和为 100', async () => {
    const report = await sensor.run('project-1', validHtml);
    const total = report.checks.reduce((s, c) => s + (c.weight ?? 0), 0);
    expect(total).toBe(100);
  });
});
