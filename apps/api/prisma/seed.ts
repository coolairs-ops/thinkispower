import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding ErrorPatterns...');

  const patterns = [
    {
      patternKey: 'html_structure_corrupted',
      name: 'HTML 结构损坏',
      publicName: '页面结构异常',
      stage: 'p3_verify',
      signals: {
        regex: ['缺少 DOCTYPE', '缺少 html 标签', '缺少 head 标签', '缺少 body 标签'],
        keywords: ['DOCTYPE', 'html', 'head', 'body'],
      },
      commonCauses: [
        'DeepSeek 返回的 HTML 片段不完整',
        '代码块提取失败，混入了 markdown 标记',
        '合并逻辑遗漏了文档头信息',
      ],
      recommendedActions: {
        fixPrompt: '确保输出完整的 HTML 文档结构，包含 <!DOCTYPE html>、<html>、<head> 和 <body> 标签。不要省略任何部分。',
        fallbackStrategy: 'retry_with_stricter_prompt',
      },
      autoFixable: true,
      severity: 'critical',
      successRate: 0.5,
    },
    {
      patternKey: 'pages_definition_lost',
      name: 'pages 定义丢失',
      publicName: '页面路由异常',
      stage: 'p3_verify',
      signals: {
        regex: ['pages 定义丢失', 'var pages', 'let pages', 'const pages'],
        keywords: ['pages', 'navigate'],
      },
      commonCauses: [
        '修改时误删了 JavaScript 的 pages 定义',
        '合并时 script 标签内容被覆盖',
        'DeepSeek 重写了整个 script 块',
      ],
      recommendedActions: {
        fixPrompt: '保留 var pages = { ... } 定义及所有页面条目(navigate 函数)。只修改目标模块的 render() 内容，不要改动 pages 结构。',
        fallbackStrategy: 'retry_with_preserved_script',
      },
      autoFixable: true,
      severity: 'critical',
      successRate: 0.6,
    },
    {
      patternKey: 'module_render_missing',
      name: '目标模块 render() 丢失或变为占位符',
      publicName: '模块内容丢失',
      stage: 'p3_verify',
      signals: {
        regex: ['目标模块.*render.*丢失', '内容未修改.*占位符', '<!-- preserved -->'],
        keywords: ['render', 'preserved', '<!--'],
      },
      commonCauses: [
        '压缩 HTML 时目标模块也被替换为占位符',
        '正则匹配 moduleKey 失败',
        '合并时提取 render 内容出错',
      ],
      recommendedActions: {
        fixPrompt: '确保目标模块的 render() 函数包含完整的模块 HTML 内容，不要使用占位符。检查 moduleKey 是否正确匹配。',
        fallbackStrategy: 'retry_with_correct_module_key',
      },
      autoFixable: true,
      severity: 'critical',
      successRate: 0.7,
    },
    {
      patternKey: 'module_key_attributes_lost',
      name: 'data-module-key 属性丢失',
      publicName: '批注功能异常',
      stage: 'p3_verify',
      signals: {
        regex: ['缺少 data-module-key', 'data-module-key'],
        keywords: ['data-module-key'],
      },
      commonCauses: [
        '修改时删除了已有元素的 data 属性',
        '新增元素未添加 data-module-key',
        '重构模板时遗漏了属性注入',
      ],
      recommendedActions: {
        fixPrompt: '所有交互元素（按钮、输入框、表格、列表项、卡片）必须有 data-module-key 和 data-element-path 属性。保持现有元素的属性不变，新增元素也要添加。',
        fallbackStrategy: 'retry_with_attribute_reminder',
      },
      autoFixable: true,
      severity: 'high',
      successRate: 0.8,
    },
    {
      patternKey: 'regression_other_modules_changed',
      name: '非目标模块被意外修改',
      publicName: '其他模块异常变化',
      stage: 'p3_verify',
      signals: {
        regex: ['以下模块被意外修改', '意外修改'],
        keywords: ['意外修改', 'regression'],
      },
      commonCauses: [
        'DeepSeek 修改了全局样式或脚本',
        '合并逻辑将错误内容写入了其他模块',
        'Prompt 约束不足，模型自行"优化"了其他部分',
      ],
      recommendedActions: {
        fixPrompt: '严格只修改目标模块的内容。不要改动其他模块的 render() 函数、全局样式、导航栏、脚本逻辑。保持所有 data-module-key 属性不变。',
        fallbackStrategy: 'rollback_and_retry',
      },
      autoFixable: true,
      severity: 'high',
      successRate: 0.65,
    },
    {
      patternKey: 'html_too_short',
      name: '生成的 HTML 内容过短',
      publicName: '内容生成不完整',
      stage: 'cloudecode_execute',
      signals: {
        regex: ['HTML 内容过短', '长度小于'],
        keywords: ['过短', '不完整', '截断'],
      },
      commonCauses: [
        'DeepSeek 输出被截断（max_tokens 不足）',
        'DeepSeek 返回了错误信息而非 HTML',
        'API 超时导致响应不完整',
      ],
      recommendedActions: {
        fixPrompt: '输出完整的 HTML。如果内容过长，确保所有标签正确闭合，不要省略任何模块的 render() 函数。',
        fallbackStrategy: 'retry_with_increased_tokens',
      },
      autoFixable: true,
      severity: 'high',
      successRate: 0.5,
    },
    {
      patternKey: 'acceptance_criteria_unmet',
      name: '验收标准未满足',
      publicName: '功能未完全实现',
      stage: 'p3_verify',
      signals: {
        regex: ['验收未通过', '验收标准', 'criteria'],
        keywords: ['未通过', '不符合', '没有实现'],
      },
      commonCauses: [
        'DeepSeek 理解偏差，未按验收标准实现',
        '修改范围不够，只改了部分内容',
        '方案描述模糊，模型自行推测了实现方式',
      ],
      recommendedActions: {
        fixPrompt: '严格对照验收标准逐条实现。确保每条标准都在修改后的 HTML 中有对应的实现。不要遗漏任何验收条件。',
        fallbackStrategy: 'retry_with_detailed_criteria',
      },
      autoFixable: true,
      severity: 'medium',
      successRate: 0.55,
    },
    {
      patternKey: 'deepseek_api_error',
      name: 'DeepSeek API 调用失败',
      publicName: 'AI 服务异常',
      stage: 'cloudecode_execute',
      signals: {
        regex: ['API error', 'fetch failed', 'ECONNREFUSED', 'ECONNRESET', 'timeout'],
        keywords: ['API', 'timeout', '网络', '连接'],
      },
      commonCauses: [
        'API 密钥无效或过期',
        '网络连接不稳定',
        'API 服务端限流或故障',
        '请求超时',
      ],
      recommendedActions: {
        fixPrompt: '',
        fallbackStrategy: 'retry_with_backoff',
      },
      autoFixable: false,
      severity: 'critical',
      successRate: 0.3,
    },
  ];

  for (const pattern of patterns) {
    await prisma.errorPattern.upsert({
      where: { patternKey: pattern.patternKey },
      update: {
        name: pattern.name,
        publicName: pattern.publicName,
        stage: pattern.stage,
        signals: pattern.signals as any,
        commonCauses: pattern.commonCauses as any,
        recommendedActions: pattern.recommendedActions as any,
        autoFixable: pattern.autoFixable,
        severity: pattern.severity,
        successRate: pattern.successRate,
      },
      create: {
        patternKey: pattern.patternKey,
        name: pattern.name,
        publicName: pattern.publicName,
        stage: pattern.stage,
        signals: pattern.signals as any,
        commonCauses: pattern.commonCauses as any,
        recommendedActions: pattern.recommendedActions as any,
        autoFixable: pattern.autoFixable,
        severity: pattern.severity,
        successRate: pattern.successRate,
      },
    });
    console.log(`  ✓ ${pattern.patternKey}`);
  }

  console.log(`\nSeeded ${patterns.length} error patterns successfully.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
