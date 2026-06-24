/**
 * 平台能力注册表（ADR-0008 D1 权威源；接 plugin-registry.schema v2 的 catalog + maturity）。
 *
 * 这是 `docs/platform-capability-overview.md`（人读版，🟢🟡🔴 口径）的机器可用形式化：母体"自我认知"的落地。
 * 用途：把一条需求/验收标准匹配到平台已知能力 → 读它的 maturity + fulfillment，
 * 给 ADR-0008 的能力来源判定一个**权威依据**，取代纯关键词猜测（关键词降为兜底）。
 *
 * maturity 口径（与能力清单一致，按真实代码兑现度标注，非纸面）：
 *   green=🟢 已端到端通 / yellow=🟡 有地基半成 / red=🔴 未起（缺口占位，走 plugin-registry 的 gap_workflow 生长）。
 *
 * ★分寸（plugin-registry _principles）：对内保持简单自研可控——这就是一张表 + 一个匹配函数；
 *   联邦/ARD/OKF 等对外协议不在此处，边界再说。
 */

import type { Fulfillment, ExternalProtocol } from './capability-provenance';

export type Maturity = 'green' | 'yellow' | 'red';

export interface CapabilityEntry {
  /** 能力 id（对应 plugin-registry 的 plugin_id / motherbase 的 cap_id 思想） */
  capId: string;
  name: string;
  /** 需求采集/生成/可信底座/规则引擎/守护/外部适配 等 */
  category: string;
  maturity: Maturity;
  /** 该能力交付后，需求落在哪一类来源（决定评估器用什么证据判） */
  fulfillment: Fulfillment;
  /** external 才有：标准协议端口 */
  protocol?: ExternalProtocol;
  /** 命中此能力的需求信号 */
  match: RegExp;
}

/**
 * 品类边界（系统模块结构「品类边界」+ 能力清单 §3）：明确不做的 → deferred、移出能力圈。
 * "通用"是"品类内通用"，不是万能。
 */
export const OUT_OF_SCOPE = /(高并发C端|实时音视频|实时\s*IM|即时通讯|强一致.*金融核心|金融核心交易|大数据实时|实时大数据|复杂算法)/u;

/**
 * 能力目录（catalog）。条目按 maturity 标真实兑现度。
 * green/yellow → 平台能交付（self 前端可现 / backend 后端底座）；red → external 缺口（留标准端口 + gap_workflow）。
 */
export const CAPABILITY_REGISTRY: CapabilityEntry[] = [
  // ── 🟢 通用业务骨架（前端可现，self）──
  { capId: 'PLG-crud', name: '对象列表/详情/录入/台账', category: '通用业务', maturity: 'green', fulfillment: 'self',
    match: /(列表|详情|录入|台账|表单|增删改查|登记表|明细)/u },
  { capId: 'PLG-portrait', name: '对象画像/数据看板', category: '通用业务', maturity: 'green', fulfillment: 'self',
    match: /(画像|数据看板|数据大屏|仪表盘|大屏展示)/u },
  { capId: 'PLG-score', name: '评分/分级/规则引擎', category: '规则引擎', maturity: 'green', fulfillment: 'self',
    match: /(评分|分级|打分|指标计算|风险指数|信用分|规则触发)/u },
  { capId: 'PLG-knowledge', name: '知识库/溯源/问答', category: '可信底座', maturity: 'green', fulfillment: 'self',
    match: /(知识库|溯源|证据链|问答检索)/u },

  // ── 🔴 生成器缺口：是 self（前端 UI）但当前 6 块（kpi/table/detail/form/generate/richtext）产不出 →
  //    走 gap_workflow「扩生成器词汇」补 block，而非让自迭代空转撞墙（ADR-0008 D6 实测 91df174a 印证）。
  // PLG-chat-qa：2026-06-24 补了第 7 块 qa（block-renderer.qaBlock）→ maturity 🔴→🟢，生成器现已能产问答/聊天界面。
  { capId: 'PLG-chat-qa', name: '问答/聊天交互界面', category: '通用业务', maturity: 'green', fulfillment: 'self',
    match: /(聊天|对话界面|在线客服|智能客服|客服问答|智能问答|在线问答|问答界面|问答交互|消息气泡|自动回复)/u },
  { capId: 'PLG-wizard', name: '多步向导/分步表单', category: '生成器缺口', maturity: 'red', fulfillment: 'self',
    match: /(分步向导|多步向导|多步表单|步骤引导|向导式|wizard)/u },
  { capId: 'PLG-chart', name: '图表/可视化钻取', category: '生成器缺口', maturity: 'red', fulfillment: 'self',
    match: /(图表|趋势图|柱状图|折线图|饼图|可视化钻取|数据钻取)/u },
  { capId: 'PLG-kanban', name: '拖拽看板/任务流转', category: '生成器缺口', maturity: 'red', fulfillment: 'self',
    match: /(拖拽看板|看板拖拽|任务流转|kanban|拖拽排序)/u },
  { capId: 'PLG-calendar', name: '日历/排期/甘特', category: '生成器缺口', maturity: 'red', fulfillment: 'self',
    match: /(日历视图|排期表|甘特图|日程安排)/u },
  { capId: 'PLG-flow', name: '流程图/审批流可视化', category: '生成器缺口', maturity: 'red', fulfillment: 'self',
    match: /(流程图|审批流程图|流程编排|可视化流程)/u },

  // ── 🟢 后端底座能力（HTML 看不见，backend；若依 data_scope）──
  { capId: 'PLG-rbac', name: '登录/认证/权限/数据隔离', category: '后端底座', maturity: 'green', fulfillment: 'backend',
    match: /(登录认证|身份认证|鉴权|权限控制|权限管理|角色权限|数据权限|数据隔离|多用户权限|RBAC|只看自己|看全部数据|登录页|账号管理|用户管理|单点登录|SSO)/u },

  // ── 🔴 外部适配器未起（external，留标准协议端口 + gap_workflow）──
  { capId: 'PLG-ocr', name: '图像/票据/证件识别', category: '外部适配', maturity: 'red', fulfillment: 'external', protocol: 'ocr',
    match: /(拍照识别|扫描识别|图片识别|票据识别|证件识别|身份证识别|OCR)/u },
  { capId: 'PLG-asr', name: '语音转写', category: '外部适配', maturity: 'red', fulfillment: 'external', protocol: 'asr',
    match: /(语音转写|语音识别|语音输入|语音转文字|录音转写|ASR)/u },
  { capId: 'PLG-oa', name: '外部 OA / 审批对接', category: '外部适配', maturity: 'red', fulfillment: 'external', protocol: 'oa',
    match: /(OA对接|对接OA|外部审批|审批对接|办公系统对接|流程对接外部)/u },
  { capId: 'PLG-rulepack', name: '行业规则包 / 合规校验', category: '外部适配', maturity: 'yellow', fulfillment: 'external', protocol: 'rulepack',
    match: /(行业规则包|合规校验|法规校验|监管对接|药监对接)/u },
  { capId: 'PLG-sms', name: '短信网关', category: '外部适配', maturity: 'red', fulfillment: 'external', protocol: 'sms',
    match: /(短信网关|短信验证码|短信通知|短信下发)/u },
  { capId: 'PLG-email', name: '邮件网关', category: '外部适配', maturity: 'red', fulfillment: 'external', protocol: 'email',
    match: /(邮件网关|邮件下发|邮件通知发送)/u },
  { capId: 'PLG-map', name: '地图 / 定位', category: '外部适配', maturity: 'red', fulfillment: 'external', protocol: 'map',
    match: /(地图服务|地理定位|定位服务|LBS)/u },
  { capId: 'PLG-payment', name: '支付', category: '外部适配', maturity: 'red', fulfillment: 'external', protocol: 'payment',
    match: /(在线支付|微信支付|支付宝|第三方支付|收款对接)/u },
  { capId: 'PLG-external', name: '泛化第三方对接', category: '外部适配', maturity: 'red', fulfillment: 'external', protocol: 'generic',
    match: /(第三方系统|外部系统对接|接口对接|数据连接器|同步至外部|对接外部)/u },
];

/** 把需求文本匹配到能力目录条目（首个命中；外部能力优先于通用，避免"语音录入"被通用 CRUD 抢） */
export function matchCapability(text: string): CapabilityEntry | null {
  const t = text ?? '';
  // 外部/后端类是更强的信号，先匹配；通用业务骨架兜底
  const ordered = [
    ...CAPABILITY_REGISTRY.filter((e) => e.fulfillment === 'external'),
    ...CAPABILITY_REGISTRY.filter((e) => e.fulfillment === 'backend'),
    ...CAPABILITY_REGISTRY.filter((e) => e.fulfillment === 'self'),
  ];
  for (const e of ordered) {
    if (e.match.test(t)) return e;
  }
  return null;
}
