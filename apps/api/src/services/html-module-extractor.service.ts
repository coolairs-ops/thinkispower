import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

/**
 * 解析 SPA Demo HTML，提取/合并指定模块的 render() 内容。
 *
 * HTML 结构概览：
 *   <html>
 *     <head>...</head>
 *     <body>
 *       <nav>侧边栏导航</nav>
 *       <div id="main-content"></div>
 *       <script>
 *         var pages = {
 *           'dashboard': { render: function() { return `...`; }, name: '看板' },
 *           ...
 *         };
 *         function navigate(key) { ... }
 *       </script>
 *     </body>
 *   </html>
 */
@Injectable()
export class HtmlModuleExtractorService {
  private readonly logger = new Logger(HtmlModuleExtractorService.name);

  buildCondensedHtml(fullHtml: string, targetModuleKey: string): string {
    const $ = cheerio.load(fullHtml);
    const scriptContent = this.findPagesScript($);
    if (!scriptContent) {
      this.logger.warn('未找到 pages 定义，使用完整 HTML');
      return fullHtml;
    }
    const condensed = this.condensePagesScript(scriptContent, targetModuleKey);
    if (condensed === scriptContent) return fullHtml;
    this.replaceScriptContent($, scriptContent, condensed);
    return $.html();
  }

  mergeModuleContent(originalHtml: string, modifiedHtml: string, moduleKey: string): string {
    const oldRender = this.extractRenderContent(originalHtml, moduleKey);
    const newRender = this.extractRenderContent(modifiedHtml, moduleKey);
    if (!oldRender || !newRender) {
      this.logger.warn('合并失败：未找到目标模块 render 内容');
      return originalHtml;
    }
    if (oldRender === newRender) {
      this.logger.log('目标模块 render 内容未变化');
      return originalHtml;
    }
    const result = originalHtml.replace(oldRender, newRender);
    this.logger.log(`模块 ${moduleKey} render 内容已合并 (${oldRender.length} → ${newRender.length} bytes)`);
    return result;
  }

  extractRenderContent(html: string, moduleKey: string): string | null {
    const entryRegex = this.buildModuleEntryRegex(moduleKey);
    const match = html.match(entryRegex);
    if (!match) return null;
    return match[1];
  }

  /**
   * 闸门3: 模块隔离 — 检测非目标模块是否被污染，如被污染则回退到原始快照。
   */
  isolateModules(
    newHtml: string,
    snapshotHtml: string,
    targetModuleKey: string,
  ): { html: string; polluted: string[] } {
    const polluted: string[] = [];
    let fixed = newHtml;

    const allKeys = this.extractAllModuleKeys(snapshotHtml);
    if (allKeys.length === 0) return { html: newHtml, polluted: [] };

    for (const key of allKeys) {
      if (key === targetModuleKey) continue;

      const snapshotContent = this.extractRenderContent(snapshotHtml, key);
      const newContent = this.extractRenderContent(newHtml, key);

      if (!snapshotContent || !newContent) continue;

      if (snapshotContent !== newContent) {
        this.logger.warn(`模块 ${key} 被污染(${snapshotContent.length}→${newContent.length})，回退到快照`);
        fixed = fixed.replace(newContent, snapshotContent);
        polluted.push(key);
      }
    }

    return { html: fixed, polluted };
  }

  /** 从 HTML 中提取所有页面模块的 key */
  private extractAllModuleKeys(html: string): string[] {
    const scriptRegex = /\b(var|let|const)\s+pages\s*=\s*\{([\s\S]*?)\n\s*\};/;
    const match = html.match(scriptRegex);
    if (!match) return [];

    const keys: string[] = [];
    const keyRegex = /['"]([\w-]+)['"]\s*:\s*\{/g;
    let km;
    while ((km = keyRegex.exec(match[0])) !== null) {
      keys.push(km[1]);
    }
    return keys;
  }

  private findPagesScript($: cheerio.CheerioAPI): string | null {
    let found: string | null = null;
    $('script').each((_, el) => {
      const text = $(el).text();
      if (/\b(var|let|const)\s+pages\s*=\s*\{/.test(text)) {
        found = text;
        return false;
      }
    });
    return found;
  }

  private condensePagesScript(scriptText: string, targetModuleKey: string): string {
    let foundTarget = false;
    const result = scriptText.replace(
      /(['"])([\w-]+)\1\s*:\s*\{[\s\S]*?render\s*:\s*function\s*\(\s*\)\s*\{[\s\S]*?(\breturn\s*`)([\s\S]*?)(`;\s*\}[\s\S]*?name\s*:\s*['"][^'"]*['"]\s*\})/g,
      (_match, _quote: string, key: string, prefix: string, content: string, suffix: string) => {
        if (key === targetModuleKey) {
          foundTarget = true;
          return _match;
        }
        const placeholder = `<!-- module ${key}: preserved -->`;
        return `${_quote}${key}${_quote}: { render: function() { ${prefix}${placeholder}${suffix}`;
      },
    );
    return foundTarget ? result : scriptText;
  }

  private replaceScriptContent($: cheerio.CheerioAPI, oldContent: string, newContent: string): void {
    $('script').each((_, el) => {
      const $el = $(el);
      if ($el.text() === oldContent) {
        $el.text(newContent);
        return false;
      }
    });
  }

  /**
   * 构建匹配 'moduleKey': { render: function() { return `...`; }, name: '...' } 的正则。
   * 捕获组 1 = 模板字面量内容。
   */
  private buildModuleEntryRegex(moduleKey: string): RegExp {
    const esc = this.escapeRegex(moduleKey);
    const pattern =
      '[\'"]' + esc + '[\'"]\\s*:\\s*\\{' +
      '[\\s\\S]*?' +
      'render\\s*:\\s*function\\s*\\(\\s*\\)\\s*\\{' +
      '[\\s\\S]*?' +
      'return\\s*\\`' +
      '([\\s\\S]*?)' +
      '\\`;\\s*\\},\\s*name\\s*:\\s*[\'"][^\'"]*[\'"]\\s*\\}';
    return new RegExp(pattern);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
