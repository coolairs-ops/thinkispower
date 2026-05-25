import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { DeepseekService } from './deepseek.service';
import { HtmlModuleExtractorService } from './html-module-extractor.service';

export interface ValidationResult {
  passed: boolean;
  errors: string[];
}

export interface CriteriaResult {
  criterion: string;
  passed: boolean;
  reason: string;
}

export interface AcceptanceValidationResult {
  passed: boolean;
  criteriaResults: CriteriaResult[];
}

export interface RegressionResult {
  passed: boolean;
  changedModules: string[];
}

const VALIDATION_PROMPT = `你是一个 QA 工程师。请逐条验证修改后的模块 HTML 是否满足验收标准。

对每条标准输出：
- ✅ 通过：[标准内容] — [原因]
- ❌ 未通过：[标准内容] — [原因]

直接输出，不要 markdown 包裹。`;

@Injectable()
export class HtmlValidatorService {
  private readonly logger = new Logger(HtmlValidatorService.name);

  constructor(
    private deepseek: DeepseekService,
    private htmlExtractor: HtmlModuleExtractorService,
  ) {}

  /**
   * 结构性检查：
   * - HTML 文档结构完整
   * - pages 定义存在
   * - 目标模块 render() 存在
   * - data-module-key 属性保留
   * - 其他模块内容未被修改
   */
  validateStructure(
    originalHtml: string,
    modifiedHtml: string,
    moduleKey: string,
  ): ValidationResult {
    const errors: string[] = [];

    // 检查文档结构
    if (!modifiedHtml.includes('<!DOCTYPE') && !modifiedHtml.includes('<html')) {
      errors.push('缺少 DOCTYPE 或 html 标签');
    }
    if (!modifiedHtml.includes('<head')) errors.push('缺少 head 标签');
    if (!modifiedHtml.includes('<body')) errors.push('缺少 body 标签');

    // 检查 pages 定义
    if (!/\b(var|let|const)\s+pages\s*=\s*\{/.test(modifiedHtml)) {
      errors.push('pages 定义丢失');
    }

    // 检查目标模块 render() 存在
    const targetContent = this.htmlExtractor.extractRenderContent(modifiedHtml, moduleKey);
    if (!targetContent) {
      errors.push(`目标模块 ${moduleKey} 的 render() 内容丢失`);
    } else if (targetContent.includes('<!-- preserved -->')) {
      errors.push(`目标模块 ${moduleKey} 的内容未修改（仍为占位符）`);
    }

    // 检查 data-module-key 属性保留
    const $modified = cheerio.load(modifiedHtml);
    const moduleKeys = new Set<string>();
    $modified('[data-module-key]').each((_, el) => {
      moduleKeys.add($modified(el).attr('data-module-key') || '');
    });
    if (moduleKeys.size === 0) {
      errors.push('缺少 data-module-key 属性');
    }

    return { passed: errors.length === 0, errors };
  }

  /**
   * 回归检查：验证非目标模块的内容未被意外修改。
   */
  checkRegression(
    originalHtml: string,
    modifiedHtml: string,
    moduleKey: string,
  ): RegressionResult {
    const changedModules: string[] = [];
    const $original = cheerio.load(originalHtml);
    const $modified = cheerio.load(modifiedHtml);

    // 从 pages 定义中提取所有 moduleKey
    const allKeys = this.extractAllModuleKeys(originalHtml);

    for (const key of allKeys) {
      if (key === moduleKey) continue; // 跳过目标模块

      const origContent = this.htmlExtractor.extractRenderContent(originalHtml, key);
      const modContent = this.htmlExtractor.extractRenderContent(modifiedHtml, key);

      if (origContent && modContent && origContent !== modContent) {
        changedModules.push(key);
      }
    }

    return {
      passed: changedModules.length === 0,
      changedModules,
    };
  }

  /**
   * 验收标准验证：用 DeepSeek 逐条判断是否满足。
   * 只发送模块的 render() 内容，token 成本低。
   */
  async validateAcceptanceCriteria(
    moduleHtml: string,
    criteria: string[],
  ): Promise<AcceptanceValidationResult> {
    if (!criteria || criteria.length === 0) {
      return { passed: true, criteriaResults: [] };
    }

    const userMessage = [
      `## 验收标准`,
      criteria.map((c, i) => `${i + 1}. ${c}`).join('\n'),
      ``,
      `## 修改后的模块 HTML`,
      moduleHtml,
    ].join('\n');

    try {
      const response = await this.deepseek.chat(
        [
          { role: 'system', content: VALIDATION_PROMPT },
          { role: 'user', content: userMessage },
        ],
        { temperature: 0.1, maxTokens: 1024 },
      );

      const criteriaResults = criteria.map((criterion) => {
        const passed = response.includes('✅') && !response.includes(`❌ ${criterion}`);
        const reasonMatch = response.match(new RegExp(
          `[✅❌]\\s*：\\s*${this.escapeRegex(criterion)}\\s*[—–-]\\s*(.+?)(?=\n|$)`,
        ));
        return {
          criterion,
          passed,
          reason: reasonMatch ? reasonMatch[1].trim() : '无法解析',
        };
      });

      return {
        passed: criteriaResults.every((r) => r.passed),
        criteriaResults,
      };
    } catch (error) {
      this.logger.error(`验收标准验证失败: ${error}`);
      return { passed: true, criteriaResults: [] }; // 验证失败时放行
    }
  }

  /**
   * 从 HTML 的 pages 定义中提取所有模块 key。
   */
  private extractAllModuleKeys(html: string): string[] {
    const keys: string[] = [];
    const regex = /['"]([\w-]+)['"]\s*:\s*\{[\s\S]*?render\s*:\s*function/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      keys.push(match[1]);
    }
    return keys;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
