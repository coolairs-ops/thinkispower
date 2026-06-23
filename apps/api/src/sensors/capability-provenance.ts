/**
 * 能力来源分类（ADR-0008 D1）——把一条需求/验收标准判定为四类来源之一，
 * 决定后续评估器（TraceabilityValidator / 验收 gate）该用什么证据判它、要不要算进覆盖率分母。
 *
 * 纯函数、确定性、零依赖（符合 ADR-0002「hard enforcement 靠确定性而非提示词」）。
 * 保守原则：拿不准默认 `self`（仍按 HTML 判，不放过）——误判 self 只是"被 HTML 严判"，
 * 误判 external 才会让能力蒙混过验收，所以宁可漏判 external、不可错判 external。
 * 推断只是默认值，规格阶段人可显式覆盖 `fulfilledBy`。
 */

import { matchCapability, OUT_OF_SCOPE } from './capability-registry';

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
  /** 命中的能力 id（命中注册表时有），供台账/缺口工单(gap_workflow)回指 */
  capId?: string;
  /** 命中的判定信号（供台账/排查透明可溯，不参与逻辑） */
  reason: string;
}

/** 本期明确不做 → 移出覆盖率分母（lifecycle 状态，非能力本身） */
const DEFERRED = /(暂不|本期不做|不在本期|二期|后续再|暂缓|待定不做)/u;

/** 后端底座兜底信号（注册表未命中时的保守回退） */
const BACKEND_FALLBACK = /(登录认证|鉴权|权限|角色|数据隔离|多用户|\bRBAC\b|账号管理|用户管理|\bSSO\b)/u;

/**
 * 判定一条需求/验收标准的能力来源（ADR-0008 D1）。
 * 权威源 = 平台能力注册表（catalog + maturity，见 capability-registry.ts）；
 * 注册表未命中时回退保守关键词、默认 self。
 * @param criterion 形如「功能: 多用户权限管理」「页面: 登录页」「MVP: 语音录入工单」的标准串
 */
export function inferFulfillment(criterion: string): ProvenanceVerdict {
  const text = (criterion ?? '').trim();
  if (!text) return { fulfilledBy: 'self', reason: '空标准默认 self' };

  // 1) 明确延期 → deferred（优先级最高，移出分母）
  const def = DEFERRED.exec(text);
  if (def) return { fulfilledBy: 'deferred', reason: `命中延期信号「${def[0]}」` };

  // 2) 品类外（能力圈外）→ deferred
  const oos = OUT_OF_SCOPE.exec(text);
  if (oos) return { fulfilledBy: 'deferred', reason: `品类外「${oos[0]}」，不在平台能力圈` };

  // 3) 查能力注册表（权威）→ 用条目的 fulfillment + maturity
  const cap = matchCapability(text);
  if (cap) {
    return { fulfilledBy: cap.fulfillment, protocol: cap.protocol, capId: cap.capId, reason: `命中能力「${cap.name}」(${cap.maturity})` };
  }

  // 4) 注册表未命中 → 保守关键词兜底（后端信号 → backend）
  const be = BACKEND_FALLBACK.exec(text);
  if (be) return { fulfilledBy: 'backend', reason: `注册表未命中，关键词兜底「${be[0]}」→ backend` };

  // 5) 默认前端可实现 → self（保守，仍按 HTML 严判）
  return { fulfilledBy: 'self', reason: '注册表未命中、无后端信号，默认前端可实现' };
}
