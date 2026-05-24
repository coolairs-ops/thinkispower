import { Injectable } from '@nestjs/common';

const BANNED_TERMS = [
  '工程控制论', '控制论',
  'n8n', 'Cloudecode', 'Claude Code',
  'OpenClaw', '小龙虾', 'GSD', 'GSG',
  '偏差检测器', '状态观测器', '传感器阵列', '解耦控制',
  '决策树', '错误模式库', '案例复盘库', '经验资产层',
  '工作流引擎', '多 Agent', 'Agent',
  '偏差分析器', '状态估计器', '自适应控制',
];

const REPLACEMENTS: Record<string, string> = {
  '工程控制论': '系统控制方法',
  '控制论': '系统控制理论',
  'n8n': '工作流引擎',
  'Cloudecode': 'AI 开发助手',
  'Claude Code': 'AI 编程助手',
  'OpenClaw': '平台服务',
  '小龙虾': '平台内部组件',
  'GSD': '平台引擎',
  'GSG': '平台生成服务',
  '偏差检测器': '异常检测模块',
  '状态观测器': '状态监控模块',
  '传感器阵列': '数据采集模块',
  '解耦控制': '模块解耦方案',
  '决策树': '智能判断规则',
  '错误模式库': '常见问题处理经验',
  '案例复盘库': '历史项目经验',
  '经验资产层': '平台经验能力',
  '工作流引擎': '业务流程引擎',
  '多 Agent': '智能协作系统',
  'Agent': '智能体',
  '偏差分析器': '数据分析工具',
  '状态估计器': '状态评估工具',
  '自适应控制': '动态调节方案',
};

@Injectable()
export class SanitizeService {
  /**
   * 过滤用户可见文本中的内部禁用词
   */
  sanitizePublicText(input: string): string {
    let output = input ?? '';
    for (const term of BANNED_TERMS) {
      output = output.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        REPLACEMENTS[term] || '平台后台服务');
    }
    return output;
  }

  /**
   * 递归清理 JSON 响应中的字符串字段
   */
  sanitizeResponseBody(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return this.sanitizePublicText(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeResponseBody(item));
    }
    if (obj !== null && typeof obj === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = this.sanitizeResponseBody(value);
      }
      return sanitized;
    }
    return obj;
  }

  getBannedTerms(): string[] {
    return [...BANNED_TERMS];
  }
}
