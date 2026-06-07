import { Injectable } from '@nestjs/common';
import { LlmGatewayService } from '../../integrations/llm/llm-gateway.service';
import { MinioService } from '../../integrations/minio/minio.service';

/** 单个数据出口（数据离开本系统的点） */
export interface EgressPoint {
  name: string;
  category: 'llm' | 'storage';
  endpoint: string;
  model?: string;
  /** 经此出口流出的数据种类 */
  dataKinds: string;
  /** 是否域内（§1.1 数据不出域） */
  domainResident: boolean;
}

export interface DataFlowAudit {
  aiMode: 'local' | 'cloud';
  /** 所有出口均域内 */
  allDomainResident: boolean;
  /** local 模式下应全域内：aiMode!=='local' 或 allDomainResident */
  localModeConsistent: boolean;
  /** 流出域的出口（名称 + 端点），私有化下应为空 */
  externalEgress: string[];
  egress: EgressPoint[];
  generatedAt: string;
}

/**
 * 数据流向审计（P15-1 / 呼应 P0-7 §1.1 数据不出域）。
 *
 * 枚举系统中数据真正"离开本系统"的出口——目前是 LLM 推理调用（三个 profile）与对象存储（MinIO）。
 * 内部 docker 服务（cc-bridge/cloudecode 等）走部署内网、且其 AI 调用统一经 LLM 网关，不在此重复列举。
 * 用 isLocalEndpoint 判定每个出口是否域内；AI_MODE=local 时应全部域内（localModeConsistent）。
 */
@Injectable()
export class DataFlowAuditService {
  constructor(
    private readonly llm: LlmGatewayService,
    private readonly minio: MinioService,
  ) {}

  getDataFlowAudit(): DataFlowAudit {
    const egress: EgressPoint[] = [
      ...this.llm.auditEndpoints().map((e) => ({
        name: `LLM·${e.profile}`,
        category: 'llm' as const,
        endpoint: e.baseUrl,
        model: e.model,
        dataKinds: '需求文本 / 规格 / Demo HTML（送模型推理）',
        domainResident: e.domainResident,
      })),
      {
        name: '对象存储 MinIO',
        category: 'storage' as const,
        endpoint: this.minio.storageEndpoint,
        dataKinds: '上传资料原始字节',
        domainResident: this.minio.isDomainResident(),
      },
    ];

    const allDomainResident = egress.every((e) => e.domainResident);
    const aiMode = this.llm.aiMode;

    return {
      aiMode,
      allDomainResident,
      localModeConsistent: aiMode !== 'local' || allDomainResident,
      externalEgress: egress.filter((e) => !e.domainResident).map((e) => `${e.name}（${e.endpoint}）`),
      egress,
      generatedAt: new Date().toISOString(),
    };
  }
}
