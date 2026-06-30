import { buildUnresolvedRequirementsDocument } from './unresolved-requirements.service';

describe('buildUnresolvedRequirementsDocument', () => {
  it('汇总路由缺口和停滞建议，并生成模块收敛文档', () => {
    const doc = buildUnresolvedRequirementsDocument({
      id: 'e7ecab0f-863e-4499-9441-22ec5b795d5b',
      name: '测试项目',
      description: '销售管理系统',
      autoIterateState: {
        taskId: 'ai-e7ecab0f-test',
        status: 'awaiting_decision',
        statusText: '连续3轮无改善',
        round: 7,
        score: 90,
        routedGaps: [
          {
            recommendation: '需要与外部ERP系统同步订单状态',
            action: 'external-adapter',
            channel: 'gap-workflow',
            customerAction: '补充ERP接口文档',
            reason: '外部系统对接',
          },
          {
            recommendation: '58/100',
            action: 'extend-generator',
          },
        ],
        terminal: {
          type: 'stuck',
          message: '连续3轮无改善',
        },
        rounds: [
          {
            round: 5,
            recommendations: ['Excel 批量导入客户资料缺失字段映射与错误行回传'],
          },
          {
            round: 6,
            recommendations: ['Excel 批量导入客户资料缺失字段映射与错误行回传', '角色和部门权限未实现数据隔离'],
          },
          {
            round: 7,
            recommendations: ['角色和部门权限未实现数据隔离', '52/100'],
          },
        ],
      },
    });

    expect(doc.summary.total).toBe(3);
    expect(doc.summary.moduleCandidateCount).toBe(3);
    expect(doc.summary.externalInterfaceCount).toBe(1);
    expect(doc.summary.existingToolOrAgentCount).toBe(2);
    expect(doc.collectionPolicy.immediateOnlineFetch).toBe(false);
    expect(doc.requirements[0]).toMatchObject({
      id: 'REQ-001',
      category: 'external_interface',
      solutionRouteLabel: '外部接口/适配器对接',
    });
    expect(doc.moduleCandidates.map((m) => m.moduleKey)).toEqual([
      'external-integration',
      'document-knowledge-ingestion',
      'identity-access',
    ]);
    expect(doc.moduleCandidates[1].matchingHints.topics).toContain('excel-import');
    expect(doc.moduleCandidates[2].matchingHints.topics).toContain('rbac');
    expect(doc.markdown).toContain('# 未解决需求收敛文档');
    expect(doc.markdown).toContain('子体生成过程中只记录');
    expect(doc.markdown).toContain('## 模块候选');
    expect(doc.markdown).toContain('api connector');
  });

  it('没有停滞或分流缺口时返回空文档', () => {
    const doc = buildUnresolvedRequirementsDocument({
      id: 'p1',
      name: '已完成项目',
      description: null,
      autoIterateState: {
        status: 'done',
        round: 2,
        score: 96,
        rounds: [
          { round: 1, recommendations: ['列表样式优化'] },
        ],
      },
    });

    expect(doc.summary.total).toBe(0);
    expect(doc.requirements).toHaveLength(0);
    expect(doc.markdown).toContain('当前没有可汇总的未解决需求');
  });
});
