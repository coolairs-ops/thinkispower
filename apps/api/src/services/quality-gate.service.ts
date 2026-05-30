import { Injectable, Logger } from '@nestjs/common';

export interface QualityCheck {
  name: string;
  passed: boolean;
  detail?: string;
  error?: string;
}

export interface QualityReport {
  passed: boolean;
  score: number;
  checks: QualityCheck[];
}

@Injectable()
export class QualityGateService {
  private readonly logger = new Logger(QualityGateService.name);

  /** 运行全部质量门禁检查 */
  async runAllChecks(projectId: string, html: string): Promise<QualityReport> {
    const checks: QualityCheck[] = [];

    // HTML 结构完整性
    checks.push(this.checkHtmlStructure(html));

    // 必须有 data-module-key
    checks.push(this.checkDataAttributes(html));

    // 必须有导航
    checks.push(this.checkNavigation(html));

    // 不能有占位符
    checks.push(this.checkNoPlaceholders(html));

    const score = Math.round((checks.filter(c => c.passed).length / checks.length) * 100);
    return {
      passed: checks.every(c => c.passed),
      score,
      checks,
    };
  }

  private checkHtmlStructure(html: string): QualityCheck {
    const hasDoctype = /<!DOCTYPE html/i.test(html);
    const hasHead = /<head[^>]*>/i.test(html);
    const hasBody = /<body[^>]*>/i.test(html);
    const hasClosingHtml = /<\/html>/i.test(html);
    const passed = hasDoctype && hasHead && hasBody && hasClosingHtml;
    return {
      name: 'HTML结构完整性',
      passed,
      detail: passed ? 'DOCTYPE/head/body 完整' : '缺少必要标签',
    };
  }

  private checkDataAttributes(html: string): QualityCheck {
    const count = (html.match(/data-module-key=/g) || []).length;
    return {
      name: '批注标注',
      passed: count >= 2,
      detail: `${count} 个 data-module-key`,
    };
  }

  private checkNavigation(html: string): QualityCheck {
    const hasNav = /navigate\(|onclick.*nav/i.test(html);
    return {
      name: '导航交互',
      passed: hasNav,
      detail: hasNav ? '含导航函数' : '缺少导航',
    };
  }

  private checkNoPlaceholders(html: string): QualityCheck {
    // 只检测代码层面的占位符模式，忽略文本中正常的 placeholder
    const patterns = ['TODO', 'FIXME', 'lorem ipsum', '占位文本', '这里放', '待实现'];
    const found = patterns.filter(p => html.toLowerCase().includes(p.toLowerCase()));
    return {
      name: '无占位符',
      passed: found.length === 0,
      detail: found.length > 0 ? `含: ${found.join(', ')}` : '通过',
    };
  }
}
