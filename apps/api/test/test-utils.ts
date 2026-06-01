/**
 * E2E 测试工具集 — 创建测试 App、用户、项目、清理数据库。
 *
 * 数据库策略：使用真实 PostgreSQL（通过 TEST_DATABASE_URL 或自动从 DATABASE_URL 派生），
 * 每次测试后 TRUNCATE 全表数据。
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// ─── 数据库连接 ───
// 默认将 Docker 内 hostname（postgres:5432）转为宿主机（localhost:5433）
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  (process.env.DATABASE_URL || 'postgresql://platform:platform_secret@postgres:5432/platform')
    .replace('postgres:5432', 'localhost:5433');

process.env.DATABASE_URL = TEST_DATABASE_URL;

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();
  return app;
}

export function getPrisma(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

/**
 * 注册用户并返回 token + user。
 */
export async function createUser(
  app: INestApplication,
  email?: string,
  name?: string,
  password?: string,
): Promise<{ token: string; user: { id: string; email: string; name: string } }> {
  const suffix = Math.random().toString(36).substring(2, 8);
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      email: email || `test-${suffix}@example.com`,
      name: name || `Tester-${suffix}`,
      password: password || 'test123456',
    })
    .expect(201);

  return res.body as { token: string; user: { id: string; email: string; name: string } };
}

export function getAuthHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/**
 * 创建一个完整的测试项目（含 deliveryOptions）。
 * 返回项目对象。
 */
export async function seedProject(
  app: INestApplication,
  userId: string,
  overrides?: {
    name?: string;
    status?: string;
    demoHtml?: string;
    planSummary?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const prisma = getPrisma(app);

  const project = await prisma.project.create({
    data: {
      userId,
      name: overrides?.name || 'Test Project',
      status: overrides?.status || 'needs_input',
      publicStatusLabel: '正在了解需求',
      demoHtml: overrides?.demoHtml || null,
      planSummary: overrides?.planSummary as any || undefined,
      deliveryOptions: {
        create: {},
      },
    },
    include: { deliveryOptions: true },
  });

  return project as unknown as Record<string, unknown>;
}

/**
 * 清空所有测试数据（CASCADE 删除所有表）。
 */
export async function cleanupDatabase(app: INestApplication): Promise<void> {
  const prisma = getPrisma(app);
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      users, projects, project_messages, modules, tasks, feedback_items,
      demo_snapshots, builds, deployments, delivery_options, decision_rules,
      decision_logs, error_patterns, error_events, case_reviews,
      experience_recommendations
    CASCADE
  `);
}
