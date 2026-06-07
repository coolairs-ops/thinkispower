import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DataFlowAuditService } from './data-flow-audit.service';

/** 数据流向审计端点（P15-1 / §1.1）：列出数据出口与域内判定，供合规/私有化核查 */
@Controller('api/admin/data-flow-audit')
@UseGuards(JwtAuthGuard)
export class DataFlowAuditController {
  constructor(private readonly auditService: DataFlowAuditService) {}

  @Get()
  getAudit() {
    return this.auditService.getDataFlowAudit();
  }
}
