import { esc } from './app-shell.template';

/**
 * 功能段页型（混合方案 C 的确定性底座）。
 *
 * 模板默认只出"工作台(主资源列表)+知识库+问答"，**不反映业务签名功能**（如"剧本生成")。
 * 这里从 planSummary.features 识别签名功能 → 按类型套对应页型 → 作为额外 section 进前台外壳。
 * 确定性、稳定；AI 增强（按需求生成更贴合的内容）在此之上叠加、失败时回退到这里。
 */
export type FeatureKind = 'generate' | 'upload' | 'form' | 'generic';

export interface FeatureSection {
  key: string;
  label: string;
  icon: string;
  title: string;
  desc: string;
  kind: FeatureKind;
}

/** 标准能力（登录/列表/管理/查看）由登录门 + 工作台列表覆盖，不单列功能段。 */
const STANDARD_RE = /登录|注册|列表|查看|浏览|管理|历史|详情|统计|报表|看板|概览|仪表/;
const GENERATE_RE = /生成|一键|创作|出稿|智能出|自动出|拟稿|起草/;
const UPLOAD_RE = /上传|导入|附件|文件/;
const FORM_RE = /录入|新建|填写|登记|提交|申报|发起/;

/** 功能文本 → 简短标题（取破折号/冒号前的名词短语）。 */
function featureTitle(text: string): string {
  return (text.split(/[—\-:：(（]/)[0] || text).trim().slice(0, 14);
}

function classify(text: string): FeatureKind {
  if (GENERATE_RE.test(text)) return 'generate';
  if (UPLOAD_RE.test(text)) return 'upload';
  if (FORM_RE.test(text)) return 'form';
  return 'generic';
}

const ICON: Record<FeatureKind, string> = { generate: 'wand', upload: 'upload', form: 'forms', generic: 'star' };

/** 从 features 文本挑签名功能（跳过标准能力），最多 3 个。 */
export function pickFeatureSections(features: string[]): FeatureSection[] {
  const out: FeatureSection[] = [];
  for (const f of features) {
    const text = (f || '').trim();
    if (!text) continue;
    const title = featureTitle(text);
    // 标准能力按**标题**判定跳过（描述里常含"历史/管理"等会误伤，故不拿整段匹配）
    if (!title || STANDARD_RE.test(title)) continue;
    // 类型按标题优先，标题看不出再看整段（避免描述里的"历史/管理"干扰标准判定，但仍可借描述定 kind）
    const kind = classify(title) !== 'generic' ? classify(title) : classify(text);
    if (kind === 'generic') continue; // 只把"有明确交互"的(生成/上传/录入)做成功能段，避免硬造
    out.push({ key: `feat${out.length + 1}`, label: title, icon: ICON[kind], title, desc: text, kind });
    if (out.length >= 3) break;
  }
  return out;
}

/** 一个功能段的内容 HTML（用基础组件类，跟主题解耦）。演示态：交互可见、结果为占位。 */
export function renderFeatureSection(f: FeatureSection): string {
  return `<div class="h1">${esc(f.title)}</div><div class="card">${body(f)}</div>`;
}

function body(f: FeatureSection): string {
  const desc = `<p class="muted" style="margin-bottom:14px">${esc(f.desc)}</p>`;
  if (f.kind === 'generate') {
    return desc +
      `<textarea id="${f.key}-in" placeholder="在此输入（如：剧情大纲 / 主题要点）…" style="width:100%;min-height:120px;padding:10px;border:.5px solid var(--t-card-border);border-radius:8px;background:var(--t-surface);color:var(--t-text);font-size:13px"></textarea>` +
      `<div style="margin-top:12px"><button class="btn" onclick="var r=document.getElementById('${f.key}-out');r.style.display='block';r.scrollIntoView({behavior:'smooth'})"><i class="ti ti-wand"></i> 一键生成</button></div>` +
      `<div id="${f.key}-out" class="card" style="margin-top:14px;display:none;background:var(--t-surface)"><div class="muted">生成结果（演示）</div><div style="margin-top:8px">根据输入，系统将在此输出结果。接入后端后此处展示真实生成内容。</div></div>`;
  }
  if (f.kind === 'upload') {
    return desc +
      `<div style="border:1px dashed var(--t-card-border);border-radius:10px;padding:28px;text-align:center;color:var(--t-text-2)"><i class="ti ti-cloud-upload" style="font-size:28px"></i><div style="margin-top:8px">点击或拖拽文件到此处上传</div></div>` +
      `<div style="margin-top:12px"><button class="btn"><i class="ti ti-upload"></i> 开始上传</button></div>`;
  }
  // form
  return desc +
    `<div class="grid" style="grid-template-columns:1fr 1fr;max-width:560px">` +
    `<div><div class="muted" style="margin-bottom:4px">名称</div><input style="width:100%;height:34px;padding:0 10px;border:.5px solid var(--t-card-border);border-radius:8px;background:var(--t-surface);color:var(--t-text)"></div>` +
    `<div><div class="muted" style="margin-bottom:4px">备注</div><input style="width:100%;height:34px;padding:0 10px;border:.5px solid var(--t-card-border);border-radius:8px;background:var(--t-surface);color:var(--t-text)"></div>` +
    `</div><div style="margin-top:14px"><button class="btn"><i class="ti ti-check"></i> 提交</button></div>`;
}
