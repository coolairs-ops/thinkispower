import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';

const QUALITY_CHECK_PROMPT = `你是一个资深产品需求分析师，负责检查产品经理和用户之间的需求探索对话质量。

你需要分析用户的回答，输出一个 JSON（不要 markdown 包裹，纯 JSON），包含以下检查项：

## 1. 一致性检查
对比用户本轮回答和历史回答，看是否有矛盾。
输出格式：{"hasContradiction": false, "contradictionDescription": null} 或 {"hasContradiction": true, "contradictionDescription": "用户之前说 X，现在说 Y，两者矛盾"}

## 2. 模糊度检查
检测用户回答中是否包含以下回避性用语：大概、可能、到时再说、还没想好、都行、随便、差不多、应该吧
输出格式：{"isVague": false, "vagueTerms": [], "vagueSuggestion": null}
或 {"isVague": true, "vagueTerms": ["大概", "差不多"], "vagueSuggestion": "用户说'大概'，建议追问具体数量或标准"}

## 3. 维度覆盖检查
检查对话历史已经覆盖了以下 8 个探索维度中的哪些：
- 目标用户
- 用户痛点
- 使用场景
- 核心价值
- 产品形态
- MVP 范围
- 成功标准
- 参考与约束

输出格式：{"coveredDimensions": ["目标用户", "用户痛点"], "missingDimensions": ["核心价值", "MVP 范围"], "suggestedDimension": "建议下一轮探索核心价值维度"}

---

输出格式（合并）：
{
  "consistency": {"hasContradiction": false, "contradictionDescription": null},
  "ambiguity": {"isVague": false, "vagueTerms": [], "vagueSuggestion": null},
  "dimensions": {"coveredDimensions": [], "missingDimensions": [], "suggestedDimension": null}
}`;

const PRD_VALIDATION_PROMPT = `你是一个资深产品需求分析师。检查以下 PRD 的质量，看其中是否有"空话"或"占位符"内容。

输出 JSON（不要 markdown 包裹，纯 JSON）：

检查规则：
1. summary — 不能是空字符串，不能是模板话术如"业务管理系统"
2. targetUsers — 至少 2 个具体角色
3. userPainPoints — 至少 2 个具体痛点，不能是"效率低"这种空话
4. mvpScope — 至少 3 个具体功能
5. pages — 至少 3 个具体页面
6. features — 至少 3 个具体功能描述

输出格式：
{
  "isValid": true,
  "issues": [],
  "suggestion": null
}

如果有问题：
{
  "isValid": false,
  "issues": ["targetUsers 太泛，建议追问具体是什么角色"],
  "suggestion": "建议继续追问目标用户的具体身份"
}`;

export interface QualityGateResult {
  hints: string[];
  needsFollowUp: boolean;
  prdValidation?: { isValid: boolean; issues: string[]; suggestion: string | null };
}

@Injectable()
export class HermesQualityService {
  private readonly logger = new Logger(HermesQualityService.name);

  constructor(private deepseek: DeepseekService) {}

  /**
   * 对用户最新一条消息做静默质量分析。
   * 返回 hint 列表，供 MessageService 注入 PM 下一轮的 system prompt。
   */
  async analyzeResponse(allMessages: { role: string; content: string }[]): Promise<QualityGateResult> {
    const userMessages = allMessages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return { hints: [], needsFollowUp: false };

    const recentMessages = allMessages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n---\n');
    const allHistory = allMessages.map(m => `${m.role}: ${m.content}`).join('\n---\n');

    const prompt = `${QUALITY_CHECK_PROMPT}

对话历史（完整）：
${allHistory}

检查的重点是用户的最近一次回答，同时也参考历史对话中的矛盾。`;

    try {
      const response = await this.deepseek.chat(
        [{ role: 'system', content: QUALITY_CHECK_PROMPT }, { role: 'user', content: prompt }],
        { temperature: 0.1, maxTokens: 1024 },
      );

      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const hints: string[] = [];

      // 一致性 hint
      if (parsed.consistency?.hasContradiction) {
        hints.push(`[注意] ${parsed.consistency.contradictionDescription}，请在下一轮对话中帮用户澄清。`);
      }

      // 模糊度 hint
      if (parsed.ambiguity?.isVague) {
        hints.push(`[注意] 用户回答中存在模糊表达（${parsed.ambiguity.vagueTerms.join('、')}），${parsed.ambiguity.vagueSuggestion}`);
      }

      // 维度缺口 hint（每 3 轮检查一次）
      const userCount = userMessages.length;
      if (userCount % 3 === 0 && parsed.dimensions?.missingDimensions?.length > 0) {
        hints.push(`[注意] 以下维度尚未覆盖：${parsed.dimensions.missingDimensions.join('、')}。${parsed.dimensions.suggestedDimension ? '建议：' + parsed.dimensions.suggestedDimension : ''}`);
      }

      return { hints, needsFollowUp: hints.length > 0 };
    } catch (error) {
      this.logger.warn('质量门禁分析失败，跳过本轮', error);
      return { hints: [], needsFollowUp: false };
    }
  }

  /**
   * 验证 PRD 质量。
   * 在 PM 产出 PRD 后被调用。
   */
  async validatePrd(prd: any): Promise<{ isValid: boolean; issues: string[]; suggestion: string | null }> {
    const prompt = JSON.stringify(prd, null, 2);

    try {
      const response = await this.deepseek.chat(
        [{ role: 'system', content: PRD_VALIDATION_PROMPT }, { role: 'user', content: prompt }],
        { temperature: 0.1, maxTokens: 1024 },
      );

      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch (error) {
      this.logger.warn('PRD 验证失败，默认通过', error);
      return { isValid: true, issues: [], suggestion: null };
    }
  }
}
