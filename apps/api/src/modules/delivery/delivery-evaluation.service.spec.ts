import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryEvaluationService } from './delivery-evaluation.service';
import { PrismaService } from '../../database/prisma.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { QwenReviewerService } from '../../services/qwen-reviewer.service';
import { QualityGateService } from '../../services/quality-gate.service';
import { DeepseekService } from '../../services/deepseek.service';
import { HermesClient } from '../../integrations/hermes/hermes.client';
import { DeploymentService } from '../deployment/deployment.service';

describe('DeliveryEvaluationService — 企业级检查方法', () => {
  let service: DeliveryEvaluationService;

  const makeMock = () => ({}) as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryEvaluationService,
        { provide: PrismaService, useValue: makeMock() },
        { provide: HermesClient, useValue: makeMock() },
        { provide: QualityGateService, useValue: makeMock() },
        { provide: DeepseekService, useValue: { chat: jest.fn() } },
        { provide: CloudecodeClient, useValue: makeMock() },
        { provide: QwenReviewerService, useValue: makeMock() },
        { provide: DeploymentService, useValue: makeMock() },
      ],
    }).compile();

    service = module.get<DeliveryEvaluationService>(DeliveryEvaluationService);
  });

  // ═══ 功能覆盖率 ═══
  describe('checkFeatureCoverage', () => {
    const files = [
      { path: 'backend/src/modules/user/user.controller.ts', content: '@Controller("users") // 用户管理\nexport class UserController {\n  @Post() async createUser() {} // 用户创建\n}' },
      { path: 'backend/src/modules/user/user.service.ts', content: 'export class UserService { async findUsers() {} }' },
      { path: 'database/schema.sql', content: 'CREATE TABLE users (id UUID PRIMARY KEY);' },
    ];

    it('全部匹配返回100%', () => {
      const r = service['checkFeatureCoverage'](files, ['用户管理', '用户创建'], 'test');
      expect(r.coverage).toBe(1);
      expect(r.missingFeatures).toHaveLength(0);
    });

    it('全部缺失返回0%', () => {
      const r = service['checkFeatureCoverage'](files, ['支付系统', '物流追踪'], 'test');
      expect(r.coverage).toBe(0);
      expect(r.matchedFeatures).toHaveLength(0);
    });

    it('部分匹配返回正确比例', () => {
      const r = service['checkFeatureCoverage'](files, ['用户管理', '报表系统', '权限控制'], 'test');
      expect(r.coverage).toBe(1 / 3);
      expect(r.matchedFeatures).toContain('用户管理');
      expect(r.missingFeatures).toContain('报表系统');
      expect(r.missingFeatures).toContain('权限控制');
    });

    it('空features返回100%', () => {
      const r = service['checkFeatureCoverage'](files, [], 'test');
      expect(r.coverage).toBe(1);
    });
  });

  // ═══ 关键词提取 ═══
  describe('extractKeywords', () => {
    it('中文功能名提取关键词', () => {
      const kws = service['extractKeywords']('用户注册和登录功能');
      expect(kws).toContain('用户');
      expect(kws).toContain('注册');
      expect(kws).toContain('登录');
    });

    it('英文功能名提取关键词', () => {
      const kws = service['extractKeywords']('User authentication and authorization');
      expect(kws).toContain('user');
      expect(kws).toContain('authentication');
      expect(kws).toContain('authorization');
    });

    it('过滤停用词', () => {
      const kws = service['extractKeywords']('的系统功能和模块实现');
      // 连接词过滤
      expect(kws).not.toContain('的');
      expect(kws).not.toContain('和');
      // 字级bigram 会产生「系统」「功能」「模块」等短词，这是正常的
    });
  });
});
