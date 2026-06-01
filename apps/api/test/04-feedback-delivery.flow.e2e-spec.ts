import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, cleanupDatabase, createUser, getAuthHeader, getPrisma } from './test-utils';

describe('Feedback Flow (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const r = await createUser(app, 'fb@test.com', 'FeedbackTester', 'secret123');
    token = r.token;
    userId = r.user.id;

    const prisma = getPrisma(app);
    const p = await prisma.project.create({
      data: {
        userId,
        name: 'Feedback Project',
        status: 'demo_ready',
        publicStatusLabel: '预览已准备好',
        demoHtml: '<html><body>Demo</body></html>',
        deliveryOptions: { create: {} },
      },
    });
    projectId = p.id;
  });

  afterAll(async () => {
    await cleanupDatabase(app);
    await app.close();
  });

  let feedbackId: string;

  it('POST /api/projects/:id/feedback → 201 + feedback item', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/feedback`)
      .set(getAuthHeader(token))
      .send({ comment: '这个按钮太小了', moduleKey: 'dashboard' })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.comment).toBe('这个按钮太小了');
    expect(res.body.moduleKey).toBe('dashboard');
    expect(res.body.status).toBe('new');
    feedbackId = res.body.id;
  });

  it('POST /api/projects/:id/feedback with elementPath → 201', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/feedback`)
      .set(getAuthHeader(token))
      .send({ comment: '标题文字需要加粗', moduleKey: 'dashboard', elementPath: 'title-text' })
      .expect(201);

    expect(res.body.elementPath).toBe('title-text');
  });

  it('POST /api/projects/:id/feedback empty comment → 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/feedback`)
      .set(getAuthHeader(token))
      .send({ comment: '' })
      .expect(400);
  });

  it('GET /api/projects/:id/feedback → 200 + list', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/feedback`)
      .set(getAuthHeader(token))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('PATCH /api/projects/:id/feedback/:fid → 200 + updated', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/projects/${projectId}/feedback/${feedbackId}`)
      .set(getAuthHeader(token))
      .send({ status: 'resolved' })
      .expect(200);

    expect(res.body.status).toBe('resolved');
  });

  it('GET /api/projects/:id/tasks → 200 + list', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/tasks`)
      .set(getAuthHeader(token))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Delivery Flow (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const r = await createUser(app, 'deliv@test.com', 'DeliveryTester', 'secret123');
    token = r.token;
    userId = r.user.id;

    const prisma = getPrisma(app);
    const p = await prisma.project.create({
      data: {
        userId,
        name: 'Delivery Project',
        status: 'demo_ready',
        publicStatusLabel: '预览已准备好',
        demoHtml: '<html><body>Delivery Demo</body></html>',
        deliveryOptions: {
          create: {
            sourceZipEnabled: true,
            packageExportEnabled: true,
          },
        },
      },
    });
    projectId = p.id;
  });

  afterAll(async () => {
    await cleanupDatabase(app);
    await app.close();
  });

  it('GET /api/projects/:id/delivery → 200 + delivery options', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/delivery`)
      .set(getAuthHeader(token))
      .expect(200);

    expect(res.body.status).toBeDefined();
    expect(res.body.onlineUrlEnabled).toBeDefined();
    expect(typeof res.body.isPro).toBe('boolean');
  });

  it('POST /api/projects/:id/delivery/request-source-download → 201', async () => {
    // Free user expects upgradeRequired
    const res = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/delivery/request-source-download`)
      .set(getAuthHeader(token))
      .expect(201);

    expect(res.body.upgradeRequired).toBe(true);
  });

  it('POST /api/projects/:id/delivery/request-source-download with pro plan → 201 + buildId', async () => {
    const prisma = getPrisma(app);
    // Upgrade user to pro
    await prisma.user.update({ where: { id: userId }, data: { plan: 'pro' } });

    const res = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/delivery/request-source-download`)
      .set(getAuthHeader(token))
      .expect(201);

    expect(res.body.upgradeRequired).toBe(false);
    expect(res.body.buildId).toBeDefined();
    expect(res.body.status).toBe('processing');

    // Reset back to free
    await prisma.user.update({ where: { id: userId }, data: { plan: 'free' } });
  });

  it('GET /api/projects/:id/demo/snapshots → 200 + array', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/demo/snapshots`)
      .set(getAuthHeader(token))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});
