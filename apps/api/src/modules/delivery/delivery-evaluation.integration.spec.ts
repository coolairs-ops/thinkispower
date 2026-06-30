/**
 * DeliveryEvaluationService 集成测试
 * 用真实文件系统和编译工具，验证交付流水线核心方法
 */
import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DeliveryEvaluationService } from './delivery-evaluation.service';
import { DELIVERY_QUEUE } from './delivery.queue';
import { PrismaService } from '../../database/prisma.service';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { QwenReviewerService } from '../../services/qwen-reviewer.service';
import { DeployPipelineService } from '../../services/deploy-pipeline.service';
import { QualityGateService } from '../../services/quality-gate.service';
import { DeepseekService } from '../../services/deepseek.service';
import { HermesClient } from '../../integrations/hermes/hermes.client';
import { DeploymentService } from '../deployment/deployment.service';
import { AcceptanceVerificationService } from './acceptance-verification.service';
import { RuoyiProvisionService } from '../app-runtime/ruoyi-provision.service';

const makeMock = () => ({}) as any;

describe('DeliveryEvaluationService — 集成测试', () => {
  let service: DeliveryEvaluationService;
  let tmpDir: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryEvaluationService,
        { provide: PrismaService, useValue: makeMock() },
        { provide: HermesClient, useValue: makeMock() },
        { provide: QualityGateService, useValue: makeMock() },
        { provide: DeepseekService, useValue: { chat: jest.fn().mockResolvedValue('mock') } },
        { provide: CloudecodeClient, useValue: makeMock() },
        { provide: QwenReviewerService, useValue: makeMock() },
        { provide: DeployPipelineService, useValue: makeMock() },
        { provide: DeploymentService, useValue: makeMock() },
        { provide: AcceptanceVerificationService, useValue: makeMock() },
        { provide: RuoyiProvisionService, useValue: { ensureProvisioned: jest.fn().mockResolvedValue({ triggered: false, status: 'not-ruoyi' }) } },
        { provide: getQueueToken(DELIVERY_QUEUE), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<DeliveryEvaluationService>(DeliveryEvaluationService);
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tip-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ═══ 场景1: 编译修复闭环 — 真实 tsc 验证 ═══
  describe('verifyAndFixCompilation — 真实编译', () => {
    const validTs = `
export function hello(): string {
  return "world";
}
console.log(hello());
`;

    const brokenTs = `
export function hello(): string {
  return "world"  // 缺少分号 — TS不会报错，但缺类型可能
}

// 产生错误: 类型不匹配
const x: number = "string";  // TS2322
`;

    it('合法 TypeScript 应编译通过', async () => {
      const pkgJson = JSON.stringify({ name: 'test', dependencies: { typescript: '*' } });
      const tsconfig = JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true, noEmit: true } });

      const outDir = path.join(tmpDir, 'valid');
      const backendDir = path.join(outDir, 'backend', 'src');
      fs.mkdirSync(backendDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'backend', 'package.json'), pkgJson);
      fs.writeFileSync(path.join(outDir, 'backend', 'tsconfig.json'), tsconfig);
      fs.writeFileSync(path.join(backendDir, 'index.ts'), validTs);

      const result = await service['verifyAndFixCompilation'](outDir, 'backend', [], 'test');
      expect(result.passed).toBe(true);
    }, 120_000);

    it('能检测 TypeScript 错误', async () => {
      const pkgJson = JSON.stringify({ name: 'test', dependencies: { typescript: '*' } });
      const tsconfig = JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true, noEmit: true } });

      const outDir = path.join(tmpDir, 'broken');
      const backendDir = path.join(outDir, 'backend', 'src');
      fs.mkdirSync(backendDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'backend', 'package.json'), pkgJson);
      fs.writeFileSync(path.join(outDir, 'backend', 'tsconfig.json'), tsconfig);
      fs.writeFileSync(path.join(backendDir, 'index.ts'), brokenTs);

      const result = await service['verifyAndFixCompilation'](outDir, 'backend', [], 'test');
      // 应该检测到错误，3轮修复后仍未通过
      expect(result.passed).toBe(false);
      expect(result.rounds).toBe(3);
      expect(result.error).toBeDefined();
    }, 180_000);
  });

  // ═══ 场景2: 功能覆盖率 — 真实文件匹配 ═══
  describe('checkFeatureCoverage — 功能匹配', () => {
    it('100%覆盖率 — 全部匹配', () => {
      const files = [
        { path: 'backend/src/modules/user/user.controller.ts', content: '// 用户管理 CRUD\n@Controller("users")' },
        { path: 'backend/src/modules/order/order.service.ts', content: '// 订单处理\nasync createOrder() {}' },
        { path: 'database/schema.sql', content: 'CREATE TABLE orders (id UUID);' },
      ];

      const r = service['checkFeatureCoverage'](files, ['用户管理', '订单处理'], 'test');
      expect(r.coverage).toBe(1);
    });

    it('部分覆盖 — 返回正确缺失', () => {
      const files = [
        { path: 'backend/src/modules/user/user.controller.ts', content: '// 用户管理' },
      ];

      const r = service['checkFeatureCoverage'](files, ['用户管理', '支付系统', '物流'], 'test');
      expect(r.coverage).toBe(1 / 3);
      expect(r.missingFeatures).toEqual(['支付系统', '物流']);
    });

    it('0%覆盖 — 全部缺失', () => {
      const files = [{ path: 'backend/src/main.ts', content: 'console.log("hello")' }];
      const r = service['checkFeatureCoverage'](files, ['支付系统', '邮件通知'], 'test');
      expect(r.coverage).toBe(0);
    });
  });

  // ═══ 场景3: 冒烟测试生成 — 语法正确性 ═══
  describe('generateAndRunSmokeTests — 测试生成', () => {
    it('提取 API 端点并生成测试文件', async () => {
      const files = [
        {
          path: 'backend/src/modules/user/user.controller.ts',
          content: `
@Controller('users')
export class UserController {
  @Get('/') async findAll() {}
  @Post('/') async create(@Body() dto: CreateUserDto) {}
  @Get('/:id') async findOne(@Param('id') id: string) {}
  @Patch('/:id') async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {}
  @Delete('/:id') async remove(@Param('id') id: string) {}
}`,
        },
      ];

      const outDir = path.join(tmpDir, 'smoke');
      const result = await service['generateAndRunSmokeTests'](outDir, files);

      // 应该有测试文件生成
      const testPath = path.join(outDir, 'tests', 'smoke.test.js');
      expect(fs.existsSync(testPath)).toBe(true);

      // 测试文件内容包含 5 个端点
      const content = fs.readFileSync(testPath, 'utf-8');
      expect(content).toContain('GET');
      expect(content).toContain('POST');
      expect(content).toContain('PATCH');
      expect(content).toContain('DELETE');
      expect(result.testCount).toBeGreaterThanOrEqual(4);
    });

    it('无 controller 时生成基础测试', async () => {
      const files = [{ path: 'README.md', content: '# Readme' }];
      const outDir = path.join(tmpDir, 'nosmoke');

      const result = await service['generateAndRunSmokeTests'](outDir, files);

      expect(result.passed).toBe(true);
      const testPath = path.join(outDir, 'tests', 'smoke.test.js');
      expect(fs.existsSync(testPath)).toBe(true);
    });
  });

  // ═══ 场景4: 企业模板注入 — 完整性 ═══
  describe('injectEnterprisePack — 完整性', () => {
    it('注入 security + observability + Dockerfile.prod', async () => {
      const files = [
        { path: 'Dockerfile', content: 'FROM node:20\nCOPY . .\nCMD ["node", "dist/index.js"]' },
      ];

      const result = await service.injectEnterprisePack(files);

      // 4 个模板文件
      expect(result.some(f => f.path === 'backend/src/middleware/security.ts')).toBe(true);
      expect(result.some(f => f.path === 'backend/src/middleware/observability.ts')).toBe(true);
      expect(result.some(f => f.path === 'Dockerfile.prod')).toBe(true);
      expect(result.some(f => f.path === 'nginx.conf')).toBe(true);

      // security 包含 helmet
      const secFile = result.find(f => f.path === 'backend/src/middleware/security.ts');
      expect(secFile?.content).toContain('helmet');

      // Dockerfile 加了 HEALTHCHECK
      const dockerfile = result.find(f => f.path === 'Dockerfile');
      expect(dockerfile?.content).toContain('HEALTHCHECK');
    });

    it('已存在文件不重复注入', async () => {
      const files = [
        { path: 'backend/src/middleware/security.ts', content: '// custom' },
        { path: 'Dockerfile', content: 'FROM node:20' },
      ];

      const result = await service.injectEnterprisePack(files);
      const secFiles = result.filter(f => f.path === 'backend/src/middleware/security.ts');
      expect(secFiles).toHaveLength(1);
    });
  });
});
