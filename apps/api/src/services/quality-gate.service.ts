import { Injectable, Logger } from '@nestjs/common';

export interface QualityCheck {
  name: string;
  category: 'structure' | 'security' | 'ux' | 'code' | 'deploy';
  passed: boolean;
  score: number; // 0-100 per check
  detail?: string;
  recommendation?: string;
}

export interface QualityReport {
  passed: boolean;
  score: number;
  checks: QualityCheck[];
  categoryScores: Record<string, number>;
}

@Injectable()
export class QualityGateService {
  private readonly logger = new Logger(QualityGateService.name);

  /** 运行全部检查（12项） */
  async runAllChecks(projectId: string, html: string, sourceFiles?: string[]): Promise<QualityReport> {
    const checks: QualityCheck[] = [
      // ── 结构类 (4项) ──
      this.checkHtmlStructure(html),
      this.checkDataAttributes(html),
      this.checkNavigation(html),
      this.checkNoPlaceholders(html),

      // ── 安全类 (3项) ──
      this.checkNoHardcodedSecrets(html),
      this.checkNoDangerousInjection(html),
      this.checkCspMeta(html),

      // ── 体验类 (3项) ──
      this.checkMobileResponsive(html),
      this.checkImageAccessibility(html),
      this.checkFormValidation(html),

      // ── 代码/部署类 (2项) ──
      this.checkErrorHandling(html),
      this.checkApiReadiness(html),
    ];

    const score = Math.round(
      checks.reduce((sum, c) => sum + c.score, 0) / checks.length
    );

    const categoryScores: Record<string, number> = {};
    const categories = ['structure', 'security', 'ux', 'code', 'deploy'];
    for (const cat of categories) {
      const catChecks = checks.filter(c => c.category === cat);
      if (catChecks.length > 0) {
        categoryScores[cat] = Math.round(
          catChecks.reduce((s, c) => s + c.score, 0) / catChecks.length
        );
      }
    }

    return {
      passed: checks.every(c => c.passed),
      score,
      checks,
      categoryScores,
    };
  }

  /** 功能清单检测 */
  detectFeatures(html: string): number {
    const features = [
      { name: '按钮有事件', pattern: /onclick\s*=|addEventListener/i, weight: 10 },
      { name: '表单输入', pattern: /<input|<textarea|<select/i, weight: 8 },
      { name: '表单提交', pattern: /\.submit\s*\(|action\s*=\s*["']/i, weight: 8 },
      { name: '表格/列表', pattern: /<table|<ul|<ol/i, weight: 6 },
      { name: '搜索功能', pattern: /search|filter|搜索|筛选/i, weight: 8 },
      { name: '多页面/锚点', pattern: /href\s*=\s*["']#|showPage|showTab/i, weight: 8 },
      { name: '数据存储', pattern: /localStorage|sessionStorage|indexedDB/i, weight: 6 },
      { name: '状态变量', pattern: /\bconst\s+\[|\buseState|let\s+\w+\s*=\s*\{/i, weight: 4 },
      { name: '添加功能', pattern: /add|create|添加|新增|新建/i, weight: 8 },
      { name: '编辑功能', pattern: /edit|update|修改|编辑/i, weight: 8 },
      { name: '删除功能', pattern: /delete|remove|删除/i, weight: 8 },
      { name: '响应式', pattern: /@media|flex-wrap|grid-template/i, weight: 6 },
      { name: '错误处理', pattern: /try\s*\{|\.catch\s*\(|error|错误提示/i, weight: 6 },
      { name: '加载状态', pattern: /loading|加载中|spinner/i, weight: 6 },
    ];
    let totalWeight = 0, scoredWeight = 0;
    for (const f of features) { totalWeight += f.weight; if (f.pattern.test(html)) scoredWeight += f.weight; }
    return Math.round((scoredWeight / totalWeight) * 100);
  }

  computeMixedScore(aiCompleteness: number, qualityScore: number, featureScore: number): number {
    return Math.round(aiCompleteness * 0.4 + qualityScore * 0.3 + featureScore * 0.3);
  }

  // ─── 结构检查 ───

  private checkHtmlStructure(html: string): QualityCheck {
    const hasDoctype = /<!DOCTYPE/i.test(html);
    const hasHead = /<head/i.test(html);
    const hasBody = /<body/i.test(html);
    const passed = hasDoctype && hasHead && hasBody;
    const missing = [!hasDoctype && 'DOCTYPE', !hasHead && 'head', !hasBody && 'body'].filter(Boolean);
    return {
      name: 'HTML结构完整性', category: 'structure', passed,
      score: passed ? 100 : missing.length === 1 ? 66 : 33,
      detail: passed ? 'DOCTYPE + head + body 完整' : `缺失: ${missing.join(', ')}`,
    };
  }

  private checkDataAttributes(html: string): QualityCheck {
    const count = (html.match(/data-module-key=/g) || []).length;
    return {
      name: '批注标注', category: 'structure', passed: count >= 2,
      score: count >= 2 ? 100 : count === 1 ? 50 : 0,
      detail: `${count} 个 data-module-key`,
      recommendation: count < 2 ? '建议给主要模块添加 data-module-key 属性' : undefined,
    };
  }

  private checkNavigation(html: string): QualityCheck {
    const has = /navigate\(|onclick.*nav|showPage|router\.push|window\.location/i.test(html);
    return {
      name: '导航交互', category: 'structure', passed: has,
      score: has ? 100 : 0,
      detail: has ? '检测到页面导航逻辑' : '未检测到导航交互',
      recommendation: !has ? '建议添加页面间导航或 Tab 切换功能' : undefined,
    };
  }

  private checkNoPlaceholders(html: string): QualityCheck {
    const patterns = ['TODO', 'FIXME', 'lorem ipsum', '占位文本', '待实现', 'placeholder text', 'TBD'];
    const found = patterns.filter(x => html.toLowerCase().includes(x.toLowerCase()));
    return {
      name: '无残留待办内容', category: 'structure', passed: found.length === 0,
      score: found.length === 0 ? 100 : Math.max(0, 100 - found.length * 30),
      detail: found.length > 0 ? `发现: ${found.join(', ')}` : '已清理',
      recommendation: found.length > 0 ? '请移除或完成所有标记为待办的内容' : undefined,
    };
  }

  // ─── 安全检查 ───

  private checkNoHardcodedSecrets(html: string): QualityCheck {
    const patterns = [
      /(['"])\s*sk-[a-zA-Z0-9]{20,}\s*\1/,             // API keys
      /(['"])\s*AKIA[A-Z0-9]{16}\s*\1/,                 // AWS keys
      /password\s*=\s*['"][^'"]{4,}['"]/,               // Hardcoded passwords
      /secret\s*=\s*['"][^'"]{4,}['"]/,                 // Secrets
      /api_key\s*=\s*['"][^'"]{4,}['"]/,                // API keys
      /token\s*=\s*['"][^'"]{8,}['"]/,                  // Tokens
    ];
    const found = patterns.filter(p => p.test(html));
    return {
      name: '无硬编码密钥', category: 'security', passed: found.length === 0,
      score: found.length === 0 ? 100 : 0,
      detail: found.length > 0 ? `发现 ${found.length} 处疑似硬编码密钥` : '通过',
      recommendation: found.length > 0 ? '密钥应存储在环境变量中，不要硬编码在代码里' : undefined,
    };
  }

  private checkNoDangerousInjection(html: string): QualityCheck {
    const hasEval = /\beval\s*\(/i.test(html);
    const hasInnerHtmlAssign = /\.innerHTML\s*=\s*(?!['"][^<]*['"])/i.test(html);
    const hasDocumentWrite = /document\.write\s*\(/i.test(html);
    const issues = [hasEval && 'eval()', hasInnerHtmlAssign && 'innerHTML动态赋值', hasDocumentWrite && 'document.write()'].filter(Boolean);
    return {
      name: '无危险代码注入', category: 'security', passed: issues.length === 0,
      score: issues.length === 0 ? 100 : 0,
      detail: issues.length > 0 ? `发现: ${issues.join(', ')}` : '通过',
      recommendation: issues.length > 0 ? '避免使用 eval() 和直接操作 innerHTML，改用安全替代方案' : undefined,
    };
  }

  private checkCspMeta(html: string): QualityCheck {
    const hasCsp = /Content-Security-Policy/i.test(html) || /http-equiv\s*=\s*["']Content-Security-Policy/i.test(html);
    return {
      name: '内容安全策略', category: 'security', passed: hasCsp,
      score: hasCsp ? 100 : 60, // CSP 是加分项，不是必需
      detail: hasCsp ? '已设置 CSP' : '未设置（建议生产环境添加）',
      recommendation: !hasCsp ? '建议添加 Content-Security-Policy 头部防止 XSS 攻击' : undefined,
    };
  }

  // ─── 体验检查 ───

  private checkMobileResponsive(html: string): QualityCheck {
    const hasViewport = /viewport/i.test(html) && /width=device-width/i.test(html);
    const hasMediaQuery = /@media/i.test(html);
    const hasFlexGrid = /flex|grid/i.test(html);
    const score = (hasViewport ? 40 : 0) + (hasMediaQuery ? 30 : 0) + (hasFlexGrid ? 30 : 0);
    return {
      name: '移动端适配', category: 'ux', passed: score >= 70,
      score,
      detail: [
        hasViewport ? '✅ viewport' : '❌ 缺viewport',
        hasMediaQuery ? '✅ 媒体查询' : '⚠️ 无媒体查询',
        hasFlexGrid ? '✅ Flex/Grid' : '⚠️ 无弹性布局',
      ].join(' | '),
      recommendation: score < 70 ? '建议添加 viewport meta 标签和响应式媒体查询' : undefined,
    };
  }

  private checkImageAccessibility(html: string): QualityCheck {
    const imgTags = (html.match(/<img[^>]*>/gi) || []).length;
    if (imgTags === 0) {
      return { name: '图片可访问性', category: 'ux', passed: true, score: 100, detail: '无图片（通过）' };
    }
    const withAlt = (html.match(/<img[^>]*alt\s*=\s*["'][^"']*["'][^>]*>/gi) || []).length;
    const passed = withAlt >= imgTags;
    return {
      name: '图片可访问性', category: 'ux', passed,
      score: imgTags > 0 ? Math.round((withAlt / imgTags) * 100) : 100,
      detail: `${withAlt}/${imgTags} 图片有 alt 属性`,
      recommendation: !passed ? '为所有图片添加 alt 属性以提高可访问性' : undefined,
    };
  }

  private checkFormValidation(html: string): QualityCheck {
    const hasForm = /<form/i.test(html);
    if (!hasForm) {
      return { name: '表单验证', category: 'ux', passed: true, score: 100, detail: '无表单（通过）' };
    }
    const hasRequired = /required/i.test(html);
    const hasPattern = /pattern\s*=/i.test(html);
    const hasTypeValidation = /type\s*=\s*["'](email|number|tel|url|date)/i.test(html);
    const score = (hasRequired ? 35 : 0) + (hasPattern ? 35 : 0) + (hasTypeValidation ? 30 : 0);
    return {
      name: '表单验证', category: 'ux', passed: score >= 50,
      score,
      detail: [
        hasRequired ? '✅ required' : '⚠️ 缺required',
        hasPattern ? '✅ pattern' : '',
        hasTypeValidation ? '✅ type校验' : '',
      ].filter(Boolean).join(' | ') || '缺少前端验证',
      recommendation: score < 50 ? '建议为表单字段添加 required/pattern 属性和类型校验' : undefined,
    };
  }

  // ─── 代码/部署检查 ───

  private checkErrorHandling(html: string): QualityCheck {
    const hasTryCatch = /try\s*\{/i.test(html) || /\.catch\s*\(/i.test(html);
    const hasErrorDisplay = /error|错误|异常|失败/i.test(html);
    const hasOnError = /onerror\s*=/i.test(html);
    const score = (hasTryCatch ? 40 : 0) + (hasErrorDisplay ? 30 : 0) + (hasOnError ? 30 : 0);
    return {
      name: '错误处理', category: 'code', passed: score >= 40,
      score,
      detail: [
        hasTryCatch ? '✅ try-catch' : '⚠️ 无异常捕获',
        hasErrorDisplay ? '✅ 错误提示' : '',
        hasOnError ? '✅ onerror' : '',
      ].filter(Boolean).join(' | ') || '缺少错误处理',
      recommendation: score < 40 ? '建议添加 try-catch 异常处理和用户友好的错误提示' : undefined,
    };
  }

  private checkApiReadiness(html: string): QualityCheck {
    const hasFetch = /\bfetch\s*\(/i.test(html);
    const hasAxios = /axios/i.test(html);
    const hasXhr = /XMLHttpRequest/i.test(html);
    const hasApiEndpoint = /\/api\//i.test(html) || /https?:\/\/[^"'\s]+\/(api|v1|graphql)/i.test(html);
    const passed = hasFetch || hasAxios || hasXhr;
    return {
      name: 'API 就绪', category: 'code', passed,
      score: passed ? 100 : (hasApiEndpoint ? 50 : 0),
      detail: passed ? (hasFetch ? '使用 fetch' : hasAxios ? '使用 axios' : '使用 XHR') :
              hasApiEndpoint ? '有API端点但无调用代码' : '未检测到API调用',
      recommendation: !passed ? '建议添加 API 调用逻辑使前后端完整联通' : undefined,
    };
  }
}
