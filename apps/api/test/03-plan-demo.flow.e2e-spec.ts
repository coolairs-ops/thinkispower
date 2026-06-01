import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, cleanupDatabase, createUser, getAuthHeader, getPrisma } from './test-utils';

describe('Plan + Demo Flow (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const r = await createUser(app, 'plan@test.com', 'PlanTester', 'secret123');
    token = r.token;
    userId = r.user.id;

    // Create project with structuredRequirement + cached planSummary (avoid AI call)
    const prisma = getPrisma(app);
    const project = await prisma.project.create({
      data: {
        userId,
        name: 'Plan Demo Project',
        status: 'prd_ready',
        publicStatusLabel: '需求文档已确认',
        structuredRequirement: {
          prd: '这是一个博客系统，需要文章管理、分类、标签功能',
          modules: [
            { key: 'article', name: '文章管理', pages: ['文章列表', '文章编辑'] },
            { key: 'category', name: '分类管理', pages: ['分类列表'] },
          ],
        },
        planSummary: {
          pages: ['首页', '文章列表', '文章详情', '分类管理'],
          features: ['CRUD', '搜索', '分页'],
          summary: '一个完整的博客管理系统',
        },
        deliveryOptions: { create: {} },
      },
      include: { deliveryOptions: true },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await cleanupDatabase(app);
    await app.close();
  });

  it('GET /api/projects/:id/plan → 200 + plan data', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/plan`)
      .set(getAuthHeader(token))
      .expect(200);

    expect(res.body).toBeDefined();
    expect(res.body.pages).toBeDefined();
    expect(Array.isArray(res.body.pages)).toBe(true);
    expect(res.body.pages).toContain('首页');
  });

  it('GET /api/projects/:id/plan/design-suggestions → 200 or graceful error', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/plan/design-suggestions`)
      .set(getAuthHeader(token));

    // AI-dependent endpoint: 200 if DeepSeek available, 500 if unavailable
    expect([200, 500]).toContain(res.status);
    expect(res.body).toBeDefined();
  });

  it('PUT /api/projects/:id/plan/confirm → 200 + demo_generating', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/projects/${projectId}/plan/confirm`)
      .set(getAuthHeader(token))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('demo_generating');
  });

  it('PUT /api/projects/:id/plan → 200 + updated plan', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/projects/${projectId}/plan`)
      .set(getAuthHeader(token))
      .send({ summary: '更新的方案描述' })
      .expect(200);

    expect(res.body.summary).toBe('更新的方案描述');
  });

  describe('Demo', () => {
    let demoProjectId: string;

    beforeAll(async () => {
      const prisma = getPrisma(app);
      const p = await prisma.project.create({
        data: {
          userId,
          name: 'Demo Test',
          status: 'demo_ready',
          publicStatusLabel: '预览已准备好',
          demoHtml: '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>',
          deliveryOptions: { create: {} },
        },
      });
      demoProjectId = p.id;
    });

    it('GET /api/projects/:id/demo → 200 + html', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/projects/${demoProjectId}/demo`)
        .set(getAuthHeader(token))
        .expect(200);

      expect(res.body.html || res.body.demoHtml).toBeDefined();
    });

    it('GET /api/projects/:id/demo for no-demo project → 200 + empty/404', async () => {
      const prisma = getPrisma(app);
      const p = await prisma.project.create({
        data: {
          userId,
          name: 'No Demo',
          status: 'needs_input',
          publicStatusLabel: '正在了解需求',
          deliveryOptions: { create: {} },
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/projects/${p.id}/demo`)
        .set(getAuthHeader(token));

      // Should return 200 with null/empty or 404 (depending on implementation)
      expect([200, 404]).toContain(res.status);
    });
  });
});
