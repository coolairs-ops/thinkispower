/**
 * 把用户在「设计建议」里**已采纳(adopted=true)**的文字类建议（导航/布局/字段/流程）
 * 拼成一段设计约束文本，注入生成 prompt——让"采纳"真正驱动生成，而非纸面开关。
 * 配色(color)不在此：它走主题/CSS 变量（另接），故此处只取四类文字建议。
 */
const CATEGORY_LABELS: Record<string, string> = {
  navigation: '导航结构',
  layout: '页面布局',
  fields: '核心字段',
  flow: '操作流程',
};

interface MaybeSuggestion {
  category?: string;
  title?: string;
  description?: string;
  adopted?: boolean;
}

/** 返回已采纳建议的约束文本（按类别排序）；无采纳项返回空串。 */
export function adoptedDesignNotes(structuredRequirement: unknown): string {
  const list = (structuredRequirement as { designSuggestions?: unknown } | null)?.designSuggestions;
  if (!Array.isArray(list)) return '';
  const lines: string[] = [];
  for (const cat of Object.keys(CATEGORY_LABELS)) {
    for (const s of list as MaybeSuggestion[]) {
      if (s && s.adopted === true && s.category === cat && typeof s.description === 'string' && s.description) {
        lines.push(`- ${CATEGORY_LABELS[cat]}｜${s.title || ''}：${s.description}`);
      }
    }
  }
  return lines.join('\n');
}
