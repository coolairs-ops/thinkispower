/**
 * 缺口处置策略（ADR-0008 D6）——把"某条没做全"的能力来源判定（provenance + maturity）
 * 路由到对的闭合机制，**不再一律丢给客户、也不再让自迭代空转撞墙**。
 *
 * 纯函数、确定性。决策只看 `fulfilledBy` + `maturity`：
 *   - self  + 生成器能产(green/yellow/未标) → 自迭代（带刹车，平台自闭合）
 *   - self  + 缺 block(red)               → 扩生成器词汇（gap_workflow 工单，迭代做不出来）
 *   - external                            → 接标准端口适配器（gap_workflow 工单）
 *   - backend                             → 后端置备（若依，通常已自动）
 *   - deferred/品类外                      → 转人工 / 不做
 *
 * 实测依据（91df174a 客服 demo）：售前/售后问答是 self 但缺 chat block → 自迭代 4 轮卡 71、重生成也补不出，
 * 正是该走 extend-generator 而非 auto-iterate。
 */

import { ProvenanceVerdict } from './capability-provenance';

export type GapAction =
  | 'auto-iterate' // self 且生成器能产 → 闷头自迭代到通过（带刹车）
  | 'extend-generator' // self 但缺 block → 扩生成器词汇（补新 block 类型）
  | 'external-adapter' // external → 接标准协议端口适配器
  | 'backend-provision' // backend → 后端底座置备（若依）
  | 'out-of-scope'; // deferred / 品类外 → 转人工 / 不做

export interface GapDisposition {
  action: GapAction;
  /** 出口渠道 */
  channel: 'iterate' | 'gap-workflow' | 'provision' | 'human';
  /** 平台能否自动闭合（不惊动人）。false=要进工单/人工 */
  autoCloseable: boolean;
  /** 客户侧一句话动作（D6：客户看到的是"下一步"，不是内部术语） */
  customerAction: string;
  reason: string;
}

/** 把一条能力来源判定路由到处置动作（ADR-0008 D6） */
export function disposeGap(v: Pick<ProvenanceVerdict, 'fulfilledBy' | 'maturity' | 'protocol' | 'capId'>): GapDisposition {
  switch (v.fulfilledBy) {
    case 'deferred':
      return { action: 'out-of-scope', channel: 'human', autoCloseable: false, customerAction: '不在本期/品类范围，转人工评估', reason: '品类外或本期不做' };
    case 'external':
      return { action: 'external-adapter', channel: 'gap-workflow', autoCloseable: false, customerAction: `需对接外部能力（${v.protocol ?? 'generic'}），已为你登记`, reason: `外部能力 ${v.protocol ?? 'generic'} → 标准端口适配器 + 工单` };
    case 'backend':
      return { action: 'backend-provision', channel: 'provision', autoCloseable: true, customerAction: '后端能力，平台自动置备', reason: '后端底座（若依）置备，通常已自动' };
    case 'self':
    default:
      if (v.maturity === 'red') {
        // self 但生成器缺这块 block → 自迭代做不出来，进"扩生成器"工单
        return { action: 'extend-generator', channel: 'gap-workflow', autoCloseable: false, customerAction: '该界面平台正在补建能力，已为你登记', reason: `生成器缺 block（${v.capId ?? 'unknown'}）→ 扩词汇工单，不进自迭代` };
      }
      // self 且生成器能产 → 闷头自迭代（带刹车）
      return { action: 'auto-iterate', channel: 'iterate', autoCloseable: true, customerAction: '正在自动补建', reason: '生成器能产（现有 block 拼得出）→ 自迭代到通过' };
  }
}
