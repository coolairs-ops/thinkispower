import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from '../../../services/deepseek.service';
import { FactCandidate } from './knowledge.types';

const EXTRACT_PROMPT = `你是监管材料数据提取专家。从给定材料中提取**可量化、用于风险评分的关键事实**。

铁律：
1. 每条事实必须给出 quote=材料中的**原句**（一字不差、能在材料里检索到的连续文字）。编造或改写原句的会被机器校验门当场作废。
2. 只提取材料**明确写出**的事实，禁止推断、估算、脑补。材料没写的就不提。
3. value 用数值（能数清的，如次数/批次数/数量）或简短文本。

输出 JSON 数组，每条：{ "name": "事实名", "value": 数值或文本, "quote": "原句", "locator": { "paragraph": 段落序号(可选) } }
只输出 JSON 数组，不要任何解释。`;

/**
 * LLM 事实提取器（四步提取的步骤1）。AI 只负责"找候选并指向原文"——它给的 quote 会被
 * KnowledgeService 的机器校验门回原件核对，编造的出处当场作废。故即便提取粗糙也安全。
 * 真实 LLM 在此；离线/测试用确定性桩走 KnowledgeService.ingest 的 extractor 注入口。
 */
@Injectable()
export class LlmFactExtractor {
  private readonly logger = new Logger(LlmFactExtractor.name);

  constructor(private readonly deepseek: DeepseekService) {}

  async extract(text: string): Promise<FactCandidate[]> {
    const resp = await this.deepseek.chat(
      [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: text.slice(0, 12000) },
      ],
      { temperature: 0.1, maxTokens: 2048, jsonOnly: true },
    );
    return this.parse(resp);
  }

  /** 解析 LLM 返回的 JSON 数组；非法/缺字段的条目丢弃（宁缺毋滥）。 */
  private parse(raw: string): FactCandidate[] {
    let arr: unknown;
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const m = cleaned.match(/\[[\s\S]*\]/);
      arr = JSON.parse(m ? m[0] : cleaned);
    } catch {
      this.logger.warn(`提取结果非 JSON，丢弃: ${raw.slice(0, 120)}`);
      return [];
    }
    if (!Array.isArray(arr)) return [];
    const out: FactCandidate[] = [];
    for (const it of arr as any[]) {
      if (it && typeof it.name === 'string' && it.name.trim() && typeof it.quote === 'string' && it.quote.trim() && it.value !== undefined && it.value !== null) {
        out.push({ name: it.name.trim(), value: it.value, quote: it.quote.trim(), locator: it.locator && typeof it.locator === 'object' ? it.locator : undefined });
      }
    }
    return out;
  }
}
