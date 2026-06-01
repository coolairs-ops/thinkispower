import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SensorReport, FusedReport } from './sensor-report.interface';

interface LayerConfig {
  weight: number;
  sensorWeights: Record<string, number>;
}

/**
 * 传感器融合服务
 *
 * 工程控制论的"传感器融合"环节。
 * 层间权重可通过 .env 配置：
 *   SENSOR_L1_WEIGHT=30   (默认 30)
 *   SENSOR_L2_WEIGHT=20   (默认 20)
 *   SENSOR_L3_WEIGHT=50   (默认 50)
 */
@Injectable()
export class SensorFusionService {
  private readonly logger = new Logger(SensorFusionService.name);
  private layerConfig: Record<1 | 2 | 3, LayerConfig>;

  constructor(private config: ConfigService) {
    const l1 = this.parseWeight('SENSOR_L1_WEIGHT', 30);
    const l2 = this.parseWeight('SENSOR_L2_WEIGHT', 20);
    const l3 = this.parseWeight('SENSOR_L3_WEIGHT', 50);
    const total = l1 + l2 + l3;

    this.layerConfig = {
      1: { weight: l1 / total, sensorWeights: { CompileValidator: 0.35, 'L1-静态分析': 0.30, QualityGateService: 0.35 } },
      2: { weight: l2 / total, sensorWeights: { ScreenshotComparator: 0.5, 'L2-运行时状态': 0.5 } },
      3: { weight: l3 / total, sensorWeights: { CrossValidator: 0.35, TraceabilityValidator: 0.30, 'L3-语义评估': 0.35 } },
    };
  }

  private parseWeight(key: string, fallback: number): number {
    const v = this.config.get<string>(key, String(fallback));
    const n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? fallback : n;
  }

  /** 融合所有传感器报告为一份综合报告 */
  fuse(reports: SensorReport[]): FusedReport {
    if (reports.length === 0) {
      return {
        overallScore: 100, layer1Score: 100, layer2Score: 100, layer3Score: 100,
        passed: true, reports: [], recommendations: [], stopIteration: false,
      };
    }

    // 按层分组
    const byLayer: Record<1 | 2 | 3, SensorReport[]> = { 1: [], 2: [], 3: [] };
    for (const r of reports) {
      byLayer[r.layer]?.push(r);
    }

    const layer1Score = this.fuseLayer(1, byLayer[1]);
    const layer2Score = this.fuseLayer(2, byLayer[2]);
    const layer3Score = this.fuseLayer(3, byLayer[3]);

    const overallScore = Math.round(
      (layer1Score * this.layerConfig[1].weight) +
      (layer2Score * this.layerConfig[2].weight) +
      (layer3Score * this.layerConfig[3].weight)
    );

    // 推荐建议
    const recommendations = this.generateRecommendations(reports, overallScore);

    // 停止条件判断
    const stopIteration = this.shouldStop(reports, overallScore);

    return {
      overallScore,
      layer1Score, layer2Score, layer3Score,
      passed: overallScore >= 60,
      reports,
      recommendations,
      stopIteration,
    };
  }

  private fuseLayer(layer: 1 | 2 | 3, reports: SensorReport[]): number {
    if (reports.length === 0) return 100;

    const config = this.layerConfig[layer];
    let totalWeight = 0;
    let weightedSum = 0;

    for (const report of reports) {
      const w = config.sensorWeights[report.sensorName] ?? (1 / reports.length);
      totalWeight += w;
      weightedSum += report.score * w;
    }

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 100;
  }

  private generateRecommendations(reports: SensorReport[], overallScore: number): string[] {
    const recs: string[] = [];

    if (overallScore >= 90) {
      recs.push('整体质量优秀，建议进入交付阶段');
    } else if (overallScore >= 75) {
      recs.push('质量良好，修复高优先级问题后可交付');
    } else if (overallScore >= 60) {
      recs.push('质量一般，建议至少完成一轮迭代优化');
    } else {
      recs.push('质量低于标准，强烈建议启动迭代优化');
    }

    for (const report of reports) {
      const failedChecks = report.checks.filter(c => !c.passed);
      if (failedChecks.length > 0) {
        recs.push(`[${report.sensorName}] ${failedChecks.map(c => c.name).join(', ')}`);
      }

      // L3 传感器的详细建议
      if (report.layer === 3 && report.rawOutput) {
        try {
          const parsed = JSON.parse(report.rawOutput);
          if (parsed.suspectedHallucinations?.length > 0) {
            recs.push(`可疑内容: ${parsed.suspectedHallucinations.join('; ')}`);
          }
        } catch {}
      }
    }

    return recs;
  }

  private shouldStop(reports: SensorReport[], overallScore: number): boolean {
    // 达到 90 分以上停止
    if (overallScore >= 90) return true;

    // L3 语义检查全部通过则停止
    const l3Reports = reports.filter(r => r.layer === 3);
    if (l3Reports.length >= 2 && l3Reports.every(r => r.passed)) return true;

    return false;
  }
}
