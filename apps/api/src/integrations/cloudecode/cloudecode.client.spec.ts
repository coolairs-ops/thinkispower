import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CloudecodeClient } from './cloudecode.client';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { DemoSnapshotService } from '../../modules/demo-snapshot/demo-snapshot.service';
import { HtmlModuleExtractorService } from '../../services/html-module-extractor.service';
import { BACKEND_RUNTIME } from '../../modules/app-runtime/backend-runtime.interface';
import * as vm from 'vm';

describe('CloudecodeClient', () => {
  let client: CloudecodeClient;
  let prisma: PrismaService;
  let deepseek: DeepseekService;
  let demoSnapshot: DemoSnapshotService;

  const mockTask = {
    id: 'task-1',
    projectId: 'project-1',
    type: 'frontend',
    title: '修改客户列表',
    description: '在客户列表中添加一列"联系电话"',
    inputPayload: {
      moduleKey: 'customer-list',
      acceptanceCriteria: ['客户列表显示联系电话列'],
    },
    moduleId: null,
    priority: 100,
    dependencies: null,
    status: 'pending',
    resultPayload: null,
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    project: {
      id: 'project-1',
      demoHtml: '<html><body><div data-module-key="customer-list"><table><tr><td>老数据</td></tr></table></div><script>var pages={}</script></body></html>',
    },
  };

  const mockPrismaService = {
    task: {
      findUnique: jest.fn(),
    },
    project: {
      update: jest.fn(),
    },
    demoSnapshot: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockDeepseekService = {
    chat: jest.fn(),
    chatWithRetry: jest.fn(),
  };

  const mockBackend = {
    kind: 'crud' as const,
    provision: jest.fn(),
    health: jest.fn(),
    teardown: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudecodeClient,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DeepseekService, useValue: mockDeepseekService },
        DemoSnapshotService,
        HtmlModuleExtractorService,
        { provide: BACKEND_RUNTIME, useValue: mockBackend },
      ],
    }).compile();

    client = module.get<CloudecodeClient>(CloudecodeClient);
    prisma = module.get<PrismaService>(PrismaService);
    deepseek = module.get<DeepseekService>(DeepseekService);
    demoSnapshot = module.get<DemoSnapshotService>(DemoSnapshotService);
  });

  it('should be defined', () => {
    expect(client).toBeDefined();
  });

  describe('executeTask', () => {
    it('should execute a task and update demo HTML', async () => {
      mockPrismaService.task.findUnique.mockResolvedValue(mockTask);
      mockPrismaService.demoSnapshot.findFirst.mockResolvedValue(null);
      mockPrismaService.demoSnapshot.create.mockResolvedValue({ id: 'snap-1' });
      mockPrismaService.project.update.mockResolvedValue(mockTask.project);

      mockDeepseekService.chat.mockResolvedValue(
        '```html\n<!DOCTYPE html>\n<html><body><div data-module-key="customer-list"><table><tr><td>联系电话: 123</td></tr></table></div><script>var pages={}</script></body></html>\n```',
      );

      const result = await client.executeTask('task-1');

      expect(result.success).toBe(true);
      expect(result.summary).toContain('completed');
      expect(mockDeepseekService.chat).toHaveBeenCalled();
    });

    it('should return failure when task not found', async () => {
      mockPrismaService.task.findUnique.mockResolvedValue(null);

      const result = await client.executeTask('non-existent');

      expect(result.success).toBe(false);
      expect(result.rawError).toContain('not found');
    });

    it('should return failure when project has no demo HTML', async () => {
      const taskWithNoDemo = {
        ...mockTask,
        type: 'backend',
        project: { id: 'project-1', demoHtml: null },
      };
      mockPrismaService.task.findUnique.mockResolvedValue(taskWithNoDemo);

      const result = await client.executeTask('task-1');

      expect(result.success).toBe(false);
      expect(result.rawError).toContain('No demo HTML');
    });

    it('should return failure when response has no HTML', async () => {
      mockPrismaService.task.findUnique.mockResolvedValue(mockTask);
      mockDeepseekService.chat.mockResolvedValue('this is not HTML at all');

      const result = await client.executeTask('task-1');

      expect(result.success).toBe(false);
      expect(result.rawError).toContain('Failed to extract HTML');
    });

    it('should save snapshot before modifying HTML', async () => {
      mockPrismaService.task.findUnique.mockResolvedValue(mockTask);
      mockPrismaService.demoSnapshot.findFirst.mockResolvedValue(null);
      mockPrismaService.demoSnapshot.create.mockResolvedValue({ id: 'snap-1' });
      mockPrismaService.project.update.mockResolvedValue(mockTask.project);

      mockDeepseekService.chat.mockResolvedValue(
        '```html\n<!DOCTYPE html>\n<html><body>Modified</body></html>\n```',
      );

      await client.executeTask('task-1');

      expect(mockPrismaService.demoSnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: 'pipeline_execute',
            taskId: 'task-1',
          }),
        }),
      );
    });
  });

  describe('generateProject', () => {
    it('should return 8 files with correct structure', async () => {
      const files = await client.generateProject({
        name: 'My App',
        demoHtml: '<html><body>Hello</body></html>',
        planSummary: { summary: 'A test app' },
      });

      expect(files).toHaveLength(8);
      files.forEach(f => {
        expect(f).toHaveProperty('path');
        expect(f).toHaveProperty('content');
        expect(typeof f.path).toBe('string');
        expect(typeof f.content).toBe('string');
      });
    });

    it('should put demoHtml as index.html', async () => {
      const files = await client.generateProject({
        demoHtml: '<html><body>Custom Content</body></html>',
      });

      const index = files.find(f => f.path === 'index.html');
      expect(index).toBeDefined();
      expect(index!.content).toBe('<html><body>Custom Content</body></html>');
    });

    it('should sanitize project name for package.json', async () => {
      const files = await client.generateProject({
        name: 'My Special App!!!',
        demoHtml: '<html></html>',
      });

      const pkg = files.find(f => f.path === 'package.json');
      expect(pkg).toBeDefined();
      const parsed = JSON.parse(pkg!.content);
      expect(parsed.name).toBe('my-special-app');
    });

    it('should use planSummary.summary as README description', async () => {
      const files = await client.generateProject({
        name: 'test',
        demoHtml: '<html></html>',
        planSummary: { summary: 'Custom description' },
      });

      const readme = files.find(f => f.path === 'README.md');
      expect(readme).toBeDefined();
      expect(readme!.content).toContain('Custom description');
    });

    it('should use fallback description when planSummary is empty', async () => {
      const files = await client.generateProject({
        name: 'test',
        demoHtml: '<html></html>',
      });

      const readme = files.find(f => f.path === 'README.md');
      expect(readme).toBeDefined();
      expect(readme!.content).not.toContain('Custom description');
    });

    it('should use fallback HTML when demoHtml is null', async () => {
      const files = await client.generateProject({});

      const index = files.find(f => f.path === 'index.html');
      expect(index).toBeDefined();
      expect(index!.content).toContain('<!DOCTYPE html>');
    });

    it('should generate valid JSON in package.json', async () => {
      const files = await client.generateProject({
        name: 'test-app',
        demoHtml: '<html></html>',
        planSummary: { summary: 'Test' },
      });

      const pkg = files.find(f => f.path === 'package.json');
      expect(pkg).toBeDefined();
      const parsed = JSON.parse(pkg!.content);
      expect(parsed.name).toBe('test-app');
      expect(parsed.scripts).toBeDefined();
      expect(parsed.scripts.start).toContain('serve');
    });

    it('should generate all expected file paths', async () => {
      const files = await client.generateProject({
        name: 'test',
        demoHtml: '<html></html>',
      });

      const paths = files.map(f => f.path).sort();
      expect(paths).toEqual([
        '.gitignore',
        'Dockerfile',
        'README.md',
        'docker-compose.yml',
        'index.html',
        'nginx.conf',
        'package.json',
        'tests/smoke.test.js',
      ]);
    });

    it('should handle structuredRequirement without crashing', async () => {
      const files = await client.generateProject({
        name: 'test',
        demoHtml: '<html></html>',
        structuredRequirement: { prd: { productName: 'Test' } },
      });

      const pkg = files.find(f => f.path === 'package.json');
      expect(pkg).toBeDefined();
      const parsed = JSON.parse(pkg!.content);
      expect(parsed.name).toBe('test');
    });
  });

  describe('generateDemoHtmlDirect (slice 5: 真实数据对接)', () => {
    const planSummary = { summary: '待办应用', pages: ['任务'], features: ['增删改'] };

    it('提取数据模型 → 置备后端 + 注入 appData 客户端', async () => {
      mockPrismaService.project.update.mockResolvedValue({});
      mockBackend.provision.mockResolvedValue({ descriptor: {} });
      mockDeepseekService.chatWithRetry.mockResolvedValue(
        '```prisma\nmodel Todo {\n  id String @id @default(uuid())\n  title String\n}\n```\n<!DOCTYPE html><html><head></head><body><div data-module-key="t"></div><script>var pages={}</script></body></html>',
      );

      const res = await client.generateDemoHtmlDirect('p1', planSummary);
      expect(res.success).toBe(true);

      // 数据模型被持久
      expect(mockPrismaService.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ dataModel: expect.stringContaining('model Todo') }) }),
      );
      // 后端被置备
      expect(mockBackend.provision).toHaveBeenCalledWith('p1', expect.stringContaining('model Todo'));
      // demoHtml 注入了 appData 且带 projectId；数据模型块不残留
      const demoCall = mockPrismaService.project.update.mock.calls.find((c: any) => c[0].data.demoHtml);
      const demoHtml = demoCall[0].data.demoHtml as string;
      expect(demoHtml).toContain('window.appData');
      expect(demoHtml).toContain('/api/app/p1/');
      expect(demoHtml).not.toContain('model Todo');
    });

    it('无数据模型块 → 不置备后端，但仍生成 demo（向后兼容）', async () => {
      mockPrismaService.project.update.mockResolvedValue({});
      mockDeepseekService.chatWithRetry.mockResolvedValue(
        '<!DOCTYPE html><html><head></head><body><script>var pages={}</script></body></html>',
      );

      const res = await client.generateDemoHtmlDirect('p2', planSummary);
      expect(res.success).toBe(true);
      expect(mockBackend.provision).not.toHaveBeenCalled();
    });

    it('置备失败 → 降级，不阻断 demo 生成', async () => {
      mockPrismaService.project.update.mockResolvedValue({});
      mockBackend.provision.mockRejectedValue(new Error('迁移失败'));
      mockDeepseekService.chatWithRetry.mockResolvedValue(
        '```prisma\nmodel A { id String @id @default(uuid()) }\n```\n<!DOCTYPE html><html><body><script>var pages={}</script></body></html>',
      );

      const res = await client.generateDemoHtmlDirect('p3', planSummary);
      expect(res.success).toBe(true);
    });

    it('注入的 appData 客户端按 REST 约定构造请求并解包响应', async () => {
      const html = client.injectAppDataClient('<html><head></head><body></body></html>', 'proj-1');
      const iife = html.match(/\(function\(\)\{[\s\S]*\}\)\(\);/)![0];

      const calls: { url: string; method: string; body: unknown }[] = [];
      const ctx: Record<string, unknown> = {
        window: {},
        encodeURIComponent,
        fetch: (url: string, opts: { method: string; body?: string }) => {
          calls.push({ url, method: opts.method, body: opts.body });
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ id: '1' }], total: 3, page: 2, pageSize: 20 }) });
        },
      };
      vm.createContext(ctx);
      vm.runInContext(iife, ctx);
      const appData = (ctx.window as any).appData;

      const listed = await appData.list('todo', { page: 2, sort: 'createdAt:desc', filters: { title: 'x' } });
      expect(calls[0]).toEqual({ url: '/api/app/proj-1/todo?page=2&sort=createdAt%3Adesc&title=x', method: 'GET', body: undefined });
      expect(listed).toEqual({ items: [{ id: '1' }], total: 3, page: 2, pageSize: 20 });

      await appData.create('todo', { title: '买菜' });
      expect(calls[1].method).toBe('POST');
      expect(JSON.parse(calls[1].body as string)).toEqual({ title: '买菜' });
    });
  });
});
