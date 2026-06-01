import { Injectable, Logger } from '@nestjs/common';
import { QualityGateService } from '../services/quality-gate.service';
import { SensorReport, SensorCheck } from './sensor-report.interface';

@Injectable()
export class L1StaticSensor {
  private readonly logger = new Logger(L1StaticSensor.name);

  constructor(private qualityGate: QualityGateService) {}

  async run(projectId: string, demoHtml: string): Promise<SensorReport> {
    const checks: SensorCheck[] = [];

    // 1. HTML 结构完整性
    const struct = await this.qualityGate.runAllChecks(projectId, demoHtml);
    checks.push({
      name: 'HTML结构',
      passed: struct.checks.find(c => c.name === 'HTML结构')?.passed ?? false,
      score: struct.checks.find(c => c.name === 'HTML结构')?.passed ? 100 : 0,
      weight: 20,
      detail: struct.checks.find(c => c.name === 'HTML结构')?.detail,
    });

    // 2. 批注标注覆盖率
    const annotationCount = (demoHtml.match(/data-module-key=/g) || []).length;
    const elementCount = (demoHtml.match(/data-element-path=/g) || []).length;
    const annotationScore = Math.min(100, Math.round((elementCount / Math.max(annotationCount, 1)) * 100));
    checks.push({
      name: '批注标注',
      passed: annotationCount >= 2,
      score: annotationScore,
      weight: 20,
      detail: `${annotationCount}个模块, ${elementCount}个元素路径标注`,
    });

    // 3. 导航交互检查
    checks.push({
      name: '导航交互',
      passed: struct.checks.find(c => c.name === '导航交互')?.passed ?? false,
      score: struct.checks.find(c => c.name === '导航交互')?.passed ? 100 : 0,
      weight: 15,
    });

    // 4. 待办内容检查
    const placeholderCheck = struct.checks.find(c => c.name === '无残留待办内容');
    checks.push({
      name: '无残留待办',
      passed: placeholderCheck?.passed ?? true,
      score: placeholderCheck?.passed ? 100 : 0,
      weight: 15,
      detail: placeholderCheck?.detail,
    });

    // 5. HTML 体积检查
    const sizeKB = Math.round(demoHtml.length / 1024);
    const sizePassed = sizeKB <= 150;
    checks.push({
      name: 'HTML体积',
      passed: sizePassed,
      score: sizePassed ? 100 : Math.max(0, 100 - Math.round((sizeKB - 100) / 2)),
      weight: 10,
      detail: `${sizeKB}KB${sizePassed ? '' : ' (建议控制在150KB以内)'}`,
    });

    // 6. 脚本错误检测 — 检查 script 标签完整性
    const unclosedScripts = (demoHtml.match(/<script[\s>]/g) || []).length !== (demoHtml.match(/<\/script>/g) || []).length;
    checks.push({
      name: '脚本完整性',
      passed: !unclosedScripts,
      score: unclosedScripts ? 0 : 100,
      weight: 10,
      detail: unclosedScripts ? 'script 标签数量不匹配（有未闭合标签）' : '正常',
    });

    // 7. data-module-key 覆盖率（按 HTML 语义块评估）
    const sectionCount = (demoHtml.match(/<section[\s>]/g) || []).length +
                         (demoHtml.match(/<div[^>]*class="[^"]*(?:page|module|card|section)[^"]*"/g) || []).length;
    const coveragePassed = sectionCount === 0 || annotationCount >= sectionCount * 0.6;
    checks.push({
      name: '模块覆盖率',
      passed: coveragePassed,
      score: sectionCount > 0 ? Math.min(100, Math.round((annotationCount / sectionCount) * 100)) : 100,
      weight: 10,
      detail: `${annotationCount}个标注 / ${sectionCount}个语义块`,
    });

    const score = this.computeScore(checks);
    return {
      sensorName: 'L1-静态分析',
      layer: 1,
      passed: checks.every(c => c.passed),
      score,
      checks,
    };
  }

  private computeScore(checks: SensorCheck[]): number {
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    if (totalWeight === 0) return 0;
    return Math.round(checks.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);
  }
}
