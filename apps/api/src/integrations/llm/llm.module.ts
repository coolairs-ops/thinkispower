import { Module } from '@nestjs/common';
import { LlmGatewayService } from './llm-gateway.service';

/**
 * LLM 网关模块（P0-7）。统一所有 AI 调用出口，支持文本+视觉、域内/云端、AI_MODE 外呼阻断。
 * 后续把现有 deepseek/qwen 调用逐步收口到 LlmGatewayService。
 */
@Module({
  providers: [LlmGatewayService],
  exports: [LlmGatewayService],
})
export class LlmModule {}
