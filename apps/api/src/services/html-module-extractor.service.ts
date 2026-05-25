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
 *           'customer-list': { render: function() { return `...`; }, name: '客户列表' },
 *           ...
 *         };
 *         function navigate(key) { ... }
 *       </script>
 *     </body>
 *   </html>
 *
 * 每个模块的内容在 pages[key].render() 的模板字面量中。
 */
@Injectable()
export class HtmlModuleExtractorService {
  private readonly logger = new Logger(HtmlModuleExtractorService.name);

  /**
   * 构建精简版 HTML：
   * - 目标模块的 render() 内容保持完整
   * - 其他模块的 render() 内容替换为占位符
   * - 其余结构（head, nav, scripts）完全不变
   *
   * 如果找不到 pages 定义或目标模块，返回原始 HTML。
   */
  buildCondensedHtml(fullHtml: string, targetModuleKey: string): string {
    const $ = cheerio.load(fullHtml);

    const scriptContent = this.findPagesScript($);
    if (!scriptContent) {
      this.logger.warn('未找到 pages 定义，使用完整 HTML');
      return fullHtml;
    }

    const condensed = this.condensePagesScript(scriptContent, targetModuleKey);
    if (condensed === scriptContent) {
      // 目标模块未在 pages 中找到 → fallback
      return fullHtml;
    }

    this.replaceScriptContent($, scriptContent, condensed);
    return $.html();
  }

  /**
   * 从 modifiedHtml 中提取目标模块的 render() 内容，
   * 并替换回 originalHtml 的对应位置。
   * 返回合并后的完整 HTML。
   */
  mergeModuleContent(
    originalHtml: string,
    modifiedHtml: string,
    moduleKey: string,
  ): string {
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

    // 在原始 HTML 中精确替换
    const result = originalHtml.replace(oldRender, newRender);
    this.logger.log(
      `模块 ${moduleKey} render 内容已合并 (${oldRender.length} → ${newRender.length} bytes)`,
    );
    return result;
  }

  /**
   * 从 HTML 中提取指定模块的 render() 返回的模板字面量内容。
   */
  extractRenderContent(
    html: string,
    moduleKey: string,
  ): string | null {
    const entryRegex = this.buildModuleEntryRegex(moduleKey);
    const match = html.match(entryRegex);
    if (!match) return null;

    // match[1] = render 模板字面量内容
    return match[1];
  }

  /**
   * 找到包含 pages 定义的 <script> 标签内容。
   */
  private findPagesScript($: cheerio.CheerioAPI): string | null {
    let found: string | null = null;
    $('script').each((_, el) => {
      const text = $(el).text();
      if (/\b(var|let|const)\s+pages\s*=\s*\{/.test(text)) {
        found = text;
        return false; // break each loop
      }
    });
    return found;
  }

  /**
   * 压缩 pages 脚本：
   * - 目标模块的 render() 内容保留
   * - 其他模块的 render() 内容替换为占位符
   *
   * 如果目标模块未在 pages 中找到，返回原文本。
   */
  private condensePagesScript(
    scriptText: string,
    targetModuleKey: string,
  ): string {
    let foundTarget = false;

    const result = scriptText.replace(
      // 匹配完整页面条目：'key': { render: function() { return `...`; }, name: '...' },
      /(['"])([\w-]+)\1\s*:\s*\{[\s\S]*?render\s*:\s*function\s*\(\s*\)\s*\{[\s\S]*?(\breturn\s*`)([\s\S]*?)(`;\s*\}[\s\S]*?name\s*:\s*['"][^'"]*['"]\s*\})/g,
      (_match, _quote: string, key: string, prefix: string, content: string, suffix: string) => {
        if (key === targetModuleKey) {
          foundTarget = true;
          return _match; // keep target module as-is
        }
        // Condense non-target module: replace render content with placeholder
        const placeholder = `<!-- module ${key}: preserved -->`;
        return `${_quote}${key}${_quote}: { render: function() { ${prefix}${placeholder}${suffix}`;
      },
    );

    return foundTarget ? result : scriptText;
  }

  /**
   * 在 cheerio 实例中替换指定 script 内容。
   */
  private replaceScriptContent(
    $: cheerio.CheerioAPI,
    oldContent: string,
    newContent: string,
  ): void {
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
    // 使用普通字符串拼接避免模板字面量中的反引号问题
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
