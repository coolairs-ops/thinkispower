import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, cleanupDatabase } from './test-utils';

describe('Auth Flow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await cleanupDatabase(app);
    await app.close();
  });

  it('POST /api/auth/register → 201 + token + user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'alice@test.com', name: 'Alice', password: 'secret123' })
      .expect(201);

    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('alice@test.com');
    expect(res.body.user.name).toBe('Alice');
    expect(res.body.user.id).toBeDefined();
  });

  it('POST /api/auth/register duplicate email → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'alice@test.com', name: 'Alice', password: 'secret123' })
      .expect(409);
  });

  it('POST /api/auth/register invalid email → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'not-an-email', name: 'Bad', password: 'secret123' })
      .expect(400);
  });

  it('POST /api/auth/register short password → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'bob@test.com', name: 'Bob', password: '123' })
      .expect(400);
  });

  it('POST /api/auth/login → 201 + token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'secret123' })
      .expect(201);

    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('alice@test.com');
  });

  it('POST /api/auth/login wrong password → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'wrongpass' })
      .expect(401);
  });

  it('POST /api/auth/login unknown email → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'secret123' })
      .expect(401);
  });

  it('GET /api/auth/me without token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);
  });

  it('GET /api/auth/me with invalid token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('GET /api/auth/me with valid token → 200 + user profile', async () => {
    const { token } = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'me@test.com', name: 'Me', password: 'secret123' })
      .then((r) => r.body as { token: string });

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.email).toBe('me@test.com');
    expect(res.body.name).toBe('Me');
    expect(res.body.id).toBeDefined();
    expect(res.body.plan).toBeDefined();
  });
});
