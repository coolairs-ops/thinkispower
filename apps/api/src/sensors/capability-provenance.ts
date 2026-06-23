/**
 * 能力来源分类（ADR-0008 D1）——把一条需求/验收标准判定为四类来源之一，
 * 决定后续评估器（TraceabilityValidator / 验收 gate）该用什么证据判它、要不要算进覆盖率分母。
 *
 * 纯函数、确定性、零依赖（符合 ADR-0002「hard enforcement 靠确定性而非提示词」）。
 * 保守原则：拿不准默认 `self`（仍按 HTML 判，不放过）——误判 self 只是"被 HTML 严判"，
 * 误判 external 才会让能力蒙混过验收，所以宁可漏判 external、不可错判 external。
 * 推断只是默认值，规格阶段人可显式覆盖 `fulfilledBy`。
 */

export type Fulfillment = 'self' | 'backend' | 'external' | 'deferred';

/** external 能力对应的标准协议端口（ADR-0008 D3 的 Capability Port） */
export type ExternalProtocol =
  | 'asr' // 语音转写
  | 'ocr' // 图像/票据/证件识别
  | 'oa' // 外部 OA / 审批对接
  | 'rulepack' // 行业规则包 / 合规校验
  | 'sms' // 短信网关
  | 'email' // 邮件网关
  | 'map' // 地图 / 定位
  | 'payment' // 支付
  | 'generic'; // 泛化第三方对接

export interface ProvenanceVerdict {
  fulfilledBy: Fulfillment;
  /** 仅 external 有：命中的协议端口 */
  protocol?: ExternalProtocol;
  /** 命中的判定信号（供台账/排查透明可溯，不参与逻辑） */
  reason: string;
}

/** 本期明确不做 → 移出覆盖率分母 */
const DEFERRED = /(暂不|本期不做|不在本期|二期|后续再|暂缓|待定不做)/u;

/** external：协议 → 触发词（具体、克制，避免过度触发把 self 误判成 external） */
const EXTERNAL_RULES: Array<{ protocol: ExternalProtocol; re: RegExp }> = [
  { protocol: 'asr', re: /(语音转写|语音识别|语音输入|语音转文字|录音转写|\bASR\b)/u },
  { protocol: 'ocr', re: /(拍照识别|扫描识别|图片识别|票据识别|证件识别|身份证识别|\bOCR\b)/u },
  { protocol: 'oa', re: /(OA对接|对接OA|外部审批|审批对接|办公系统对接|流程对接外部)/u },
  { protocol: 'rulepack', re: /(行业规则包|合规校验|法规校验|监管对接|药监对接)/u },
  { protocol: 'sms', re: /(短信网关|短信验证码|短信通知|短信下发)/u },
  { protocol: 'email', re: /(邮件网关|邮件下发|邮件通知发送)/u },
  { protocol: 'map', re: /(地图服务|地理定位|定位服务|\bLBS\b)/u },
  { protocol: 'payment', re: /(在线支付|微信支付|支付宝|第三方支付|收款对接)/u },
  { protocol: 'generic', re: /(第三方系统|外部系统对接|接口对接|数据连接器|同步至外部|对接外部)/u },
];

/** backend：能力在后端底座（若依等），HTML 这层天然看不见 → 不该用 HTML 判 */
const BACKEND = /(登录认证|身份认证|鉴权|权限控制|权限管理|角色权限|数据权限|数据隔离|多用户权限|\bRBAC\b|只看自己|看全部数据|按角色|登录页|账号管理|用户管理|单点登录|\bSSO\b)/u;

/**
 * 判定一条需求/验收标准的能力来源。
 * @param criterion 形如「功能: 多用户权限管理」「页面: 登录页」「MVP: 语音录入工单」的标准串
 */
export function inferFulfillment(criterion: string): ProvenanceVerdict {
  const text = (criterion ?? '').trim();
  if (!text) return { fulfilledBy: 'self', reason: '空标准默认 self' };

  // 1) 明确延期 → deferred（优先级最高，移出分母）
  const def = DEFERRED.exec(text);
  if (def) return { fulfilledBy: 'deferred', reason: `命中延期信号「${def[0]}」` };

  // 2) 外部对接 → external（带协议端口）
  for (const { protocol, re } of EXTERNAL_RULES) {
    const m = re.exec(text);
    if (m) return { fulfilledBy: 'external', protocol, reason: `命中外部能力「${m[0]}」→ ${protocol}` };
  }

  // 3) 后端底座能力 → backend
  const be = BACKEND.exec(text);
  if (be) return { fulfilledBy: 'backend', reason: `命中后端能力「${be[0]}」` };

  // 4) 兜底：前端可实现 → self（保守默认，仍按 HTML 严判）
  return { fulfilledBy: 'self', reason: '无后端/外部信号，默认前端可实现' };
}
