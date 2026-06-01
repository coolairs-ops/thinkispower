/** 单条传感器检查结果 */
export interface SensorCheck {
  name: string;
  passed: boolean;
  score: number;       // 0-100
  weight: number;      // 该检查在传感器内的权重
  detail?: string;
  error?: string;
}

/** 单个传感器的输出 */
export interface SensorReport {
  sensorName: string;
  layer: 1 | 2 | 3;    // L1静态 L2运行时 L3语义
  passed: boolean;
  score: number;        // 0-100
  checks: SensorCheck[];
  rawOutput?: string;   // 原始工具输出（调试用）
}

/** 所有传感器融合后的最终报告 */
export interface FusedReport {
  overallScore: number;      // 0-100
  layer1Score: number;       // 静态检查分
  layer2Score: number;       // 运行时检查分
  layer3Score: number;       // 语义检查分
  passed: boolean;
  reports: SensorReport[];
  recommendations: string[];
  stopIteration: boolean;    // true = 建议停止迭代
}
