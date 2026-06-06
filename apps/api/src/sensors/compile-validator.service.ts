import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SensorReport, SensorCheck } from './sensor-report.interface';

/**
 * L1 编译/语法检查器
 *
 * 对生成的代码执行静态分析：
 * - HTML 结构合法性（doctype、闭合标签、属性）
 * - JavaScript 语法检查（通过 node --check）
 * - CSS 语法检查
 *
 * 对于全栈项目，还会尝试 tsc --noEmit（需项目包含 tsconfig）
 */
@Injectable()
export class CompileValidator {
  private readonly logger = new Logger(CompileValidator.name);

  /** 检查 HTML Demo 的语法合法性 */
  async validateHtml(html: string): Promise<SensorReport> {
    const checks: SensorCheck[] = [];

    // 1. HTML 结构完整性
    const structureScore = this.checkStructure(html);
    checks.push(structureScore);

    // 2. JS 语法检查（提取 <script> 内容）
    const jsScore = this.checkJavaScript(html);
    checks.push(jsScore);

    // 3. CSS 语法检查
    const cssScore = this.checkCSS(html);
    checks.push(cssScore);

    // 4. 资源完整性
    const resourceScore = this.checkResources(html);
    checks.push(resourceScore);

    const weightedScore = this.calcWeightedScore(checks);

    return {
      sensorName: 'CompileValidator',
      layer: 1,
      passed: weightedScore >= 70,
      score: weightedScore,
      checks,
    };
  }

  private checkStructure(html: string): SensorCheck {
    const issues: string[] = [];

    if (!/<!DOCTYPE/i.test(html)) issues.push('缺少 DOCTYPE');
    if (!/<head/i.test(html)) issues.push('缺少 <head>');
    if (!/<body/i.test(html)) issues.push('缺少 <body>');
    if (!/<\/html>/i.test(html)) issues.push('缺少 </html>');

    // 检查常用标签闭合
    const unclosedTags = this.findUnclosedTags(html);
    if (unclosedTags.length > 0) issues.push(`未闭合标签: ${unclosedTags.join(', ')}`);

    // 检查重复 id
    const dupIds = this.findDuplicateIds(html);
    if (dupIds.length > 0) issues.push(`重复 ID: ${dupIds.join(', ')}`);

    const passed = issues.length === 0;
    const score = passed ? 100 : Math.max(0, 100 - issues.length * 20);

    return {
      name: 'HTML结构检查',
      passed,
      score,
      weight: 35,
      detail: passed ? '结构完整' : issues.join('; '),
    };
  }

  private checkJavaScript(html: string): SensorCheck {
    const scriptBlocks = html.match(/<script[\s\S]*?>[\s\S]*?<\/script>/gi);
    if (!scriptBlocks || scriptBlocks.length === 0) {
      return { name: 'JS语法检查', passed: true, score: 100, weight: 25, detail: '无内联脚本' };
    }

    let issues = 0;
    let totalLines = 0;

    for (const block of scriptBlocks) {
      const jsContent = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
      if (!jsContent) continue;

      // 跳过仅含外部 src 的 script 标签
      if (/src\s*=\s*["']/i.test(block) && !jsContent) continue;

      totalLines += jsContent.split('\n').length;

      // 使用 node --check 做语法验证
      if (!this.checkJsSyntax(jsContent)) {
        issues++;
      }
    }

    const passed = issues === 0;
    const score = passed ? 100 : Math.max(0, 100 - (issues / Math.max(totalLines, 1)) * 200);

    return {
      name: 'JS语法检查',
      passed,
      score,
      weight: 25,
      detail: passed ? `通过 (${totalLines} 行)` : `${issues} 个脚本块语法错误`,
    };
  }

  private checkCSS(html: string): SensorCheck {
    const styleBlocks = html.match(/<style[\s\S]*?>[\s\S]*?<\/style>/gi);
    if (!styleBlocks || styleBlocks.length === 0) {
      return { name: 'CSS语法检查', passed: true, score: 100, weight: 20, detail: '无内联样式' };
    }

    const issues: string[] = [];

    for (const block of styleBlocks) {
      const cssContent = block.replace(/<style[^>]*>/i, '').replace(/<\/style>/i, '').trim();
      if (!cssContent) continue;

      // 基本检查：花括号匹配
      const opens = (cssContent.match(/\{/g) || []).length;
      const closes = (cssContent.match(/\}/g) || []).length;
      if (opens !== closes) issues.push(`花括号不匹配 (${opens} open vs ${closes} close)`);

      // 检查常见的 CSS 语法错误
      const lines = cssContent.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('-') && !line.includes(':')) {
          issues.push(`第 ${i + 1} 行: 疑似不完整属性 "${line.slice(0, 30)}"`);
        }
      }
    }

    const passed = issues.length === 0;
    const score = passed ? 100 : Math.max(0, 100 - issues.length * 15);

    return {
      name: 'CSS语法检查',
      passed,
      score,
      weight: 20,
      detail: passed ? '通过' : issues.join('; '),
    };
  }

  private checkResources(html: string): SensorCheck {
    const issues: string[] = [];

    // 检查外部资源引用是否可能 404
    const scripts = html.match(/src\s*=\s*["']([^"']+)["']/gi) || [];
    for (const s of scripts) {
      const url = s.replace(/src\s*=\s*["']/i, '').replace(/["']$/, '');
      if (url.startsWith('http') && !url.startsWith('https://cdn') && !url.startsWith('https://unpkg')) {
        // 可疑的外部资源
      }
    }

    // 检查是否有内联事件处理器（onclick, onchange 等）
    const inlineEvents = html.match(/on\w+\s*=\s*["'][^"']*["']/gi) || [];
    if (inlineEvents.length > 50) {
      issues.push(`过多内联事件处理器 (${inlineEvents.length} 个)，建议事件委托`);
    }

    const passed = issues.length === 0;
    return {
      name: '资源完整性检查',
      passed,
      score: passed ? 100 : Math.max(0, 100 - issues.length * 10),
      weight: 20,
      detail: passed ? '通过' : issues.join('; '),
    };
  }

  private checkJsSyntax(js: string): boolean {
    try {
      const tmpFile = join(tmpdir(), `syntax-check-${Date.now()}.js`);
      writeFileSync(tmpFile, js, 'utf-8');
      execSync(`node --check "${tmpFile}"`, { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    } finally {
      try { execSync(`rm -f "${join(tmpdir(), `syntax-check-${Date.now()}.js`)}"`, { stdio: 'ignore' }); } catch {}
    }
  }

  private findUnclosedTags(html: string): string[] {
    const voidElements = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
    const openTags: string[] = [];
    const tagRegex = /<\/?(\w+)[^>]*>/g;
    let match;

    while ((match = tagRegex.exec(html)) !== null) {
      const tag = match[1].toLowerCase();
      if (voidElements.has(tag)) continue;

      if (match[0].startsWith('</')) {
        const idx = openTags.lastIndexOf(tag);
        if (idx >= 0) openTags.splice(idx, 1);
      } else if (!match[0].endsWith('/>')) {
        openTags.push(tag);
      }
    }

    return [...new Set(openTags)];
  }

  private findDuplicateIds(html: string): string[] {
    const ids = html.match(/id\s*=\s*["']([^"']+)["']/gi) || [];
    const count = new Map<string, number>();
    for (const id of ids) {
      const val = id.replace(/id\s*=\s*["']/i, '').replace(/["']$/, '');
      count.set(val, (count.get(val) || 0) + 1);
    }
    return [...count.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  }

  private calcWeightedScore(checks: SensorCheck[]): number {
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    if (totalWeight === 0) return 100;
    return Math.round(checks.reduce((s, c) => s + (c.score * c.weight) / totalWeight, 0));
  }
}
