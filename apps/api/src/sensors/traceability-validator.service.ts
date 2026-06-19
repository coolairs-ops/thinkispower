import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from '../services/deepseek.service';
import { QwenClient } from './qwen-client.service';
import { SensorReport, SensorCheck } from './sensor-report.interface';

const TRACEABILITY_PROMPT = `你是一个需求追踪专家。检查以下 Demo HTML 是否完整实现了所有需求。

对比"需求清单"和"实际 HTML"，逐条判断：

需求清单中的每一项是否在 HTML 中有对应的功能实现。
- 完全实现 → passed: true
- 部分实现 → passed: false, score: 50-80
- 未实现   → passed: false, score: 0-30

输出 JSON（不要 markdown 包裹）：
{
  "traceability": [
    { "requirement": "...", "found": true, "score": 100, "evidence": "找到对应功能: ..." },
    { "requirement": "...", "found": false, "score": 0, "evidence": "缺少对应实现" }
  ],
  "coverage": 0-100,
  "missing": ["未实现的需求1", "未实现的需求2"]
}`;

@Injectable()
export class TraceabilityValidator {
  private readonly logger = new Logger(TraceabilityValidator.name);

  constructor(
    private deepseek: DeepseekService,
    private qwen: QwenClient,
  ) {}

  /** 验证需求-实现可追溯性 */
  async validate(
    projectId: string,
    demoHtml: string,
    planSummary: any,
    structuredRequirement: any,
  ): Promise<SensorReport> {
    const checks: SensorCheck[] = [];

    // 提取验收标准
    const acceptanceCriteria = this.extractAcceptanceCriteria(planSummary, structuredRequirement);
    if (acceptanceCriteria.length === 0) {
      return {
        sensorName: 'TraceabilityValidator',
        layer: 3,
        passed: true,
        score: 100,
        checks: [{ name: '需求追溯', passed: true, score: 100, weight: 100, detail: '无明确的验收标准，跳过' }],
      };
    }

    // 先尝试用 Qwen 做追溯（如果有配置），否则用 DeepSeek
    const evaluator = this.qwen.available ? this.qwen : this.deepseek;
    const evaluatorName = this.qwen.available ? 'Qwen' : 'DeepSeek(自评)';

    try {
      const userMessage = [
        `## 需求清单（${acceptanceCriteria.length} 项）`,
        acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n'),
        ``,
        `## Demo HTML（前 15000 字符）`,
        demoHtml.slice(0, 15000),
      ].join('\n');

      const response = await (evaluator as any).chat(
        [
          { role: 'system', content: TRACEABILITY_PROMPT },
          { role: 'user', content: userMessage },
        ],
        { temperature: 0.2, maxTokens: 4096 },
      );

      if (!response) {
        throw new Error('Empty response from evaluator');
      }

      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const result = JSON.parse(cleaned);

      if (result.traceability && Array.isArray(result.traceability)) {
        for (const item of result.traceability) {
          checks.push({
            name: `需求: ${item.requirement.slice(0, 60)}`,
            passed: item.found,
            score: item.score ?? (item.found ? 100 : 0),
            weight: 100 / acceptanceCriteria.length,
            detail: item.evidence || (item.found ? '已实现' : '未找到对应实现'),
          });
        }
      }

      const coverage = result.coverage ?? 0;

      if (result.missing?.length > 0) {
        checks.push({
          name: '未实现需求汇总',
          passed: result.missing.length <= Math.ceil(acceptanceCriteria.length * 0.2),
          score: Math.max(0, 100 - result.missing.length * 20),
          weight: 10,
          detail: `${result.missing.length} 项未实现: ${result.missing.join('; ')}`,
        });
      }

      return {
        sensorName: 'TraceabilityValidator',
        layer: 3,
        passed: coverage >= 70,
        score: Math.round(coverage),
        checks,
        rawOutput: JSON.stringify({ missing: result.missing, evaluator: evaluatorName }),
      };
    } catch (error) {
      this.logger.warn(`追溯验证降级 (project ${projectId}): ${error instanceof Error ? error.message : String(error)}`);
      return {
        sensorName: 'TraceabilityValidator',
        layer: 3,
        passed: false,
        score: 0,
        checks: [{ name: '追溯验证调用', passed: false, score: 0, weight: 100, detail: `错误: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }

  private extractAcceptanceCriteria(planSummary: any, structuredRequirement: any): string[] {
    const criteria: string[] = [];

    // 从验收标准中提取
    if (planSummary?.acceptanceChecklist) {
      if (Array.isArray(planSummary.acceptanceChecklist)) {
        criteria.push(...planSummary.acceptanceChecklist.filter(Boolean));
      }
    }
    // 兼容旧字段名
    if (planSummary?.acceptanceCriteria) {
      if (Array.isArray(planSummary.acceptanceCriteria)) {
        criteria.push(...planSummary.acceptanceCriteria.filter(Boolean));
      }
    }

    // 从页面+功能提取隐含需求
    if (planSummary?.pages && Array.isArray(planSummary.pages)) {
      for (const page of planSummary.pages) {
        if (typeof page === 'string') criteria.push(`页面: ${page}`);
        else if (page.name) criteria.push(`页面: ${page.name}`);
      }
    }

    if (planSummary?.features && Array.isArray(planSummary.features)) {
      for (const feat of planSummary.features) {
        if (typeof feat === 'string') criteria.push(`功能: ${feat}`);
        else if (feat.name) criteria.push(`功能: ${feat.name}`);
      }
    }

    // 从 structuredRequirement 中的 prd 提取
    const prd = structuredRequirement?.prd || structuredRequirement;
    if (prd?.mvpScope && Array.isArray(prd.mvpScope)) {
      criteria.push(...prd.mvpScope.map((s: string) => `MVP: ${s}`));
    }
    if (prd?.features && Array.isArray(prd.features)) {
      criteria.push(...prd.features.map((f: string) => `功能: ${f}`));
    }
    if (prd?.pages && Array.isArray(prd.pages)) {
      criteria.push(...prd.pages.map((p: string) => `页面: ${p}`));
    }

    // 去重：同一需求常从多个源重复收集（如"多用户权限"既在 features 又在 prd.mvpScope），
    // 否则 LLM 会逐条重复评测、产出"重复需求X，已验证"的虚胖条目、白烧预算。
    // 按"剥掉 页面:/功能:/MVP: 前缀后的内容"为 key 去重，保留首次出现（含其分类标签）。
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const c of criteria) {
      const key = c.replace(/^(页面|功能|MVP|需求|场景)[:：]\s*/u, '').trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        deduped.push(c);
      }
    }
    return deduped;
  }
}
