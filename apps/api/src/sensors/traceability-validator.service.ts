import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from '../services/deepseek.service';
import { QwenClient } from './qwen-client.service';
import { SensorReport, SensorCheck } from './sensor-report.interface';
import { inferFulfillment, Fulfillment } from './capability-provenance';

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

  /**
   * 验证需求-实现可追溯性（ADR-0008：按能力来源分流，不再一律拿 HTML 判）。
   *  - self     → 判 demo HTML（LLM 追溯，现状）
   *  - backend  → 认后端置备（backendReady=true 即信用，否则记"待后端置备"）
   *  - external → 标"待外部对接(协议)"，受控放行、**不算未实现**、移出覆盖率分母
   *  - deferred → 本期不做，移出分母
   * coverage = (self 已实现 + backend 已信用) / (self + backend)，external/deferred 不进分母。
   */
  async validate(
    projectId: string,
    demoHtml: string,
    planSummary: any,
    structuredRequirement: any,
    opts: { backendReady?: boolean } = {},
  ): Promise<SensorReport> {
    const backendReady = opts.backendReady ?? false;

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

    // 按能力来源分桶
    const classified = acceptanceCriteria.map((text) => ({ text, ...inferFulfillment(text) }));
    const bucket = (f: Fulfillment) => classified.filter((c) => c.fulfilledBy === f);
    const selfC = bucket('self');
    const backendC = bucket('backend');
    const externalC = bucket('external');
    const deferredC = bucket('deferred');

    const checks: SensorCheck[] = [];
    const missing: string[] = [];
    const denom = selfC.length + backendC.length; // external/deferred 不进分母
    const itemWeight = denom > 0 ? 100 / denom : 100;

    // ── self：判 demo HTML（LLM 追溯）──
    let selfImpl = 0;
    if (selfC.length > 0) {
      try {
        const r = await this.judgeAgainstHtml(selfC.map((c) => c.text), demoHtml);
        for (const item of r.traceability) {
          checks.push({
            name: `需求: ${String(item.requirement).slice(0, 60)}`,
            passed: !!item.found,
            score: item.score ?? (item.found ? 100 : 0),
            weight: itemWeight,
            detail: item.evidence || (item.found ? '已实现' : '未找到对应实现'),
          });
          if (item.found) selfImpl++;
          else missing.push(String(item.requirement));
        }
        // LLM 漏判的 self 项（返回条数 < 送入条数）保守计未实现
        const judged = r.traceability.length;
        if (judged < selfC.length) {
          for (const c of selfC.slice(judged)) missing.push(c.text);
        }
      } catch (error) {
        // 仅 self 这一桶降级；backend/external/deferred 仍确定性记账，不让整体归零
        this.logger.warn(`self 追溯降级 (project ${projectId}): ${error instanceof Error ? error.message : String(error)}`);
        checks.push({ name: 'self 追溯调用', passed: false, score: 0, weight: itemWeight, detail: `判定服务暂不可用，${selfC.length} 项 self 需求计未实现` });
        for (const c of selfC) missing.push(c.text);
      }
    }

    // ── backend：后端底座能力，按置备状态信用 ──
    for (const c of backendC) {
      checks.push({
        name: `后端能力: ${c.text.slice(0, 60)}`,
        passed: backendReady,
        score: backendReady ? 100 : 0,
        weight: itemWeight,
        detail: backendReady ? '后端底座已置备（若依），按置备/契约信用，不以 HTML 判' : '待后端置备（HTML 不该判此项）',
      });
      if (!backendReady) missing.push(`${c.text}（待后端置备）`);
    }
    const backendImpl = backendReady ? backendC.length : 0;

    // ── external：待外部对接，受控放行、非未实现、移出分母 ──
    for (const c of externalC) {
      checks.push({
        name: `外部能力: ${c.text.slice(0, 60)}`,
        passed: true,
        score: 100,
        weight: 5,
        detail: `待外部对接（${c.protocol}）— 受控放行，留标准端口+备忘录，非未实现`,
      });
    }
    // ── deferred：本期不做，移出分母 ──
    for (const c of deferredC) {
      checks.push({ name: `本期不做: ${c.text.slice(0, 60)}`, passed: true, score: 100, weight: 1, detail: '本期不做，移出覆盖率分母' });
    }

    const impl = selfImpl + backendImpl;
    const coverage = denom > 0 ? Math.round((100 * impl) / denom) : 100;

    if (externalC.length > 0) {
      checks.push({
        name: '外部能力待对接汇总',
        passed: true,
        score: 100,
        weight: 5,
        detail: `${externalC.length} 项待外部对接（非未实现）: ${externalC.map((c) => `${c.text}[${c.protocol}]`).join('; ')}`,
      });
    }
    if (missing.length > 0) {
      checks.push({
        name: '未实现需求汇总',
        passed: missing.length <= Math.ceil(denom * 0.2),
        score: Math.max(0, 100 - missing.length * 20),
        weight: 10,
        detail: `${missing.length} 项未实现: ${missing.join('; ')}`,
      });
    }

    const evaluatorName = this.qwen.available ? 'Qwen' : 'DeepSeek(自评)';
    return {
      sensorName: 'TraceabilityValidator',
      layer: 3,
      passed: coverage >= 70,
      score: coverage,
      checks,
      rawOutput: JSON.stringify({
        missing,
        external: externalC.map((c) => ({ text: c.text, protocol: c.protocol })),
        deferred: deferredC.map((c) => c.text),
        buckets: { self: selfC.length, backend: backendC.length, external: externalC.length, deferred: deferredC.length },
        backendReady,
        evaluator: evaluatorName,
      }),
    };
  }

  /** 把一批需求（仅 self 类）拿 demo HTML 做 LLM 追溯判定 */
  private async judgeAgainstHtml(
    criteria: string[],
    demoHtml: string,
  ): Promise<{ traceability: Array<{ requirement: string; found: boolean; score?: number; evidence?: string }>; coverage: number; missing: string[] }> {
    const evaluator = this.qwen.available ? this.qwen : this.deepseek;
    const userMessage = [
      `## 需求清单（${criteria.length} 项）`,
      criteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n'),
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
    if (!response) throw new Error('Empty response from evaluator');

    const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(cleaned);
    return {
      traceability: Array.isArray(result.traceability) ? result.traceability : [],
      coverage: result.coverage ?? 0,
      missing: Array.isArray(result.missing) ? result.missing : [],
    };
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
