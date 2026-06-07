import { DataFlowAuditService } from './data-flow-audit.service';

describe('DataFlowAuditService', () => {
  const make = (
    aiMode: 'local' | 'cloud',
    llmEndpoints: Array<{ profile: string; baseUrl: string; model: string; domainResident: boolean }>,
    minioDomain: boolean,
    minioEndpoint = 'http://minio:9000',
  ) => {
    const llm = { aiMode, auditEndpoints: jest.fn().mockReturnValue(llmEndpoints) };
    const minio = { storageEndpoint: minioEndpoint, isDomainResident: jest.fn().mockReturnValue(minioDomain) };
    return new DataFlowAuditService(llm as never, minio as never);
  };

  it('local 全域内 → allDomainResident、localModeConsistent、externalEgress 为空', () => {
    const svc = make('local', [
      { profile: 'text-primary', baseUrl: 'http://localhost:8000/v1', model: 'qwen', domainResident: true },
      { profile: 'text-validator', baseUrl: 'http://10.0.0.5/v1', model: 'qwen', domainResident: true },
    ], true);
    const r = svc.getDataFlowAudit();
    expect(r.aiMode).toBe('local');
    expect(r.allDomainResident).toBe(true);
    expect(r.localModeConsistent).toBe(true);
    expect(r.externalEgress).toEqual([]);
    expect(r.egress).toHaveLength(3); // 2 llm + 1 storage
    expect(r.egress.find((e) => e.category === 'storage')!.domainResident).toBe(true);
    expect(r.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('cloud + LLM 外呼 → 标 externalEgress、allDomainResident=false、cloud 下 consistent', () => {
    const svc = make('cloud', [
      { profile: 'text-primary', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', domainResident: false },
    ], true);
    const r = svc.getDataFlowAudit();
    expect(r.allDomainResident).toBe(false);
    expect(r.externalEgress).toHaveLength(1);
    expect(r.externalEgress[0]).toContain('api.deepseek.com');
    expect(r.localModeConsistent).toBe(true); // cloud 不要求全域内
  });

  it('local 但存在外呼 → localModeConsistent=false（私有化违规，应告警）', () => {
    const svc = make('local', [
      { profile: 'text-primary', baseUrl: 'https://api.deepseek.com/v1', model: 'x', domainResident: false },
    ], true);
    const r = svc.getDataFlowAudit();
    expect(r.localModeConsistent).toBe(false);
    expect(r.externalEgress[0]).toContain('api.deepseek.com');
  });

  it('存储非域内也计入 externalEgress', () => {
    const svc = make('cloud', [], false, 'https://oss.aliyuncs.com');
    const r = svc.getDataFlowAudit();
    expect(r.egress).toHaveLength(1); // 0 llm + 1 storage
    expect(r.egress[0].category).toBe('storage');
    expect(r.externalEgress[0]).toContain('oss.aliyuncs.com');
    expect(r.allDomainResident).toBe(false);
  });
});
