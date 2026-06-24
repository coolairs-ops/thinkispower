import { Injectable, Logger } from '@nestjs/common';
import { QwenClient } from './qwen-client.service';
import { SensorReport, SensorCheck } from './sensor-report.interface';
import { condenseHtmlForJudge } from './html-condense';

const CROSS_VALIDATE_PROMPT = `你是一个独立的软件质量评估专家。另一名 AI 工程师生成了以下代码/HTML。请从以下维度独立评估其质量，给出客观评分。

评估维度：
1. 功能完备性 — 是否包含所需功能，有无明显遗漏
2. 代码健壮性 — 有无明显 bug、错误处理、边界情况
3. 用户体验 — 交互是否合理、状态提示是否完整
4. 代码质量 — 结构是否清晰、有无冗余/死代码

输出 JSON 格式（不要 markdown 包裹）：
{
  "completeness": 0-100,
  "robustness": 0-100,
  "ux": 0-100,
  "quality": 0-100,
  "overall": 0-100,
  "issues": ["问题1", "问题2"],
  "strengths": ["优点1"],
  "suspectedHallucinations": ["可疑内容1"]  // 你认为可能幻觉/不正确的内容
}`;

@Injectable()
export class CrossValidator {
  private readonly logger = new Logger(CrossValidator.name);

  constructor(private qwen: QwenClient) {}

  /** 用 Qwen 对 DeepSeek 生成的 HTML 做交叉验证 */
  async validate(projectId: string, demoHtml: string, planSummary: string): Promise<SensorReport> {
    const checks: SensorCheck[] = [];

    if (!this.qwen.available) {
      this.logger.warn('Qwen 未配置，跳过交叉验证');
      checks.push({
        name: '交叉验证模型可用性',
        passed: false,
        score: 0,
        weight: 100,
        detail: 'QWEN_API_KEY 未配置，交叉验证已跳过',
      });
      return {
        sensorName: 'CrossValidator',
        layer: 3,
        passed: false,
        score: 0,
        checks,
      };
    }

    try {
      const response = await this.qwen.chat([
        {
          role: 'system',
          content: CROSS_VALIDATE_PROMPT,
        },
        {
          role: 'user',
          content: [
            `## 项目计划`,
            planSummary.slice(0, 4000),
            ``,
            `## Demo HTML（前 12000 字符）`,
            condenseHtmlForJudge(demoHtml),
          ].join('\n'),
        },
      ], { temperature: 0.2, maxTokens: 2048 });

      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const result = JSON.parse(cleaned);

      checks.push(
        { name: '功能完备性 (Qwen)', passed: result.completeness >= 60, score: result.completeness, weight: 30, detail: `${result.completeness}/100` },
        { name: '代码健壮性 (Qwen)', passed: result.robustness >= 60, score: result.robustness, weight: 25, detail: `${result.robustness}/100` },
        { name: '用户体验 (Qwen)', passed: result.ux >= 60, score: result.ux, weight: 20, detail: `${result.ux}/100` },
        { name: '代码质量 (Qwen)', passed: result.quality >= 60, score: result.quality, weight: 25, detail: `${result.quality}/100` },
      );

      // 检出可疑内容
      if (result.suspectedHallucinations?.length > 0) {
        checks.push({
          name: '幻觉检测',
          passed: false,
          score: Math.max(0, 100 - result.suspectedHallucinations.length * 20),
          weight: 15,
          detail: `疑似幻觉 ${result.suspectedHallucinations.length} 项: ${result.suspectedHallucinations.join('; ')}`,
        });
      }

      const overallScore = result.overall ?? 0;

      return {
        sensorName: 'CrossValidator',
        layer: 3,
        passed: overallScore >= 60,
        score: overallScore,
        checks,
        rawOutput: JSON.stringify({ issues: result.issues, strengths: result.strengths, suspectedHallucinations: result.suspectedHallucinations }),
      };
    } catch (error) {
      this.logger.error(`交叉验证失败 (project ${projectId}):`, error as any);
      return {
        sensorName: 'CrossValidator',
        layer: 3,
        passed: false,
        score: 0,
        checks: [{ name: '交叉验证调用', passed: false, score: 0, weight: 100, detail: `错误: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
}
