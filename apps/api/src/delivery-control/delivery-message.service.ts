import { Injectable } from '@nestjs/common';
import { SanitizeService } from '../services/sanitize.service';

/**
 * 交付控制层 — 双消息结构
 *
 * 所有任务结果/状态都拆成两条消息：
 *   - internalMessage：保留技术细节（命令、堆栈、内部工具名），仅日志/管理员可见。
 *   - publicMessage：用户可见文案，经现有 SanitizeService 脱敏，不含内部技术词。
 *
 * 复用现有 sanitize.service（@Global），不另起一套脱敏。
 */

export interface DeliveryMessage {
  /** 内部技术细节（仅日志/管理员可见） */
  internalMessage: string;
  /** 用户可见文案（已脱敏） */
  publicMessage: string;
}

@Injectable()
export class DeliveryMessageService {
  constructor(private readonly sanitize: SanitizeService) {}

  /**
   * 构造双消息：internal 原样保留；public 经脱敏。
   * 优先使用显式 publicMessage，否则由 internalMessage 脱敏生成；
   * 显式 publicMessage 也会再过一遍脱敏作为兜底。
   */
  build(internalMessage: string, publicMessage?: string): DeliveryMessage {
    const source = publicMessage ?? internalMessage;
    return {
      internalMessage,
      publicMessage: this.sanitize.sanitizePublicText(source),
    };
  }
}
