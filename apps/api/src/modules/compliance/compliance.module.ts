import { Module } from '@nestjs/common';
import { LlmModule } from '../../integrations/llm/llm.module';
import { DataFlowAuditService } from './data-flow-audit.service';
import { DataFlowAuditController } from './data-flow-audit.controller';

/**
 * 合规模块（P15-1）：数据流向审计等私有化/可追溯能力。
 * MinioService 由 @Global MinioModule 提供；LlmGatewayService 由 LlmModule 提供。
 */
@Module({
  imports: [LlmModule],
  controllers: [DataFlowAuditController],
  providers: [DataFlowAuditService],
  exports: [DataFlowAuditService],
})
export class ComplianceModule {}
