/**
 * 路 B 端到端验收（ADR-0001 / slice 8）—— 集成测试，需真 Postgres。
 *
 * 串起 LLM 产物之后的确定性全链路：数据模型 → 部署置备(建表) → 经 /api/app 后端真 CRUD
 * → 后端传感器感知健康/故障。固化为可重复回归护栏，替代分片开发期的一次性脚本。
 *
 * 启用：设 TEST_DATABASE_URL（如本地 docker 的 postgresql://platform:platform_secret@localhost:5433/platform）。
 * 默认随 `npm test` 跑；探测不到 DB 时整组自动跳过——不破坏无库的 CI/本地单测。
 * 不覆盖「需求→LLM 生成 demo+数据模型」那一段（依赖真 LLM，需线上验证）。
 */
import { PrismaClient } from '@prisma/client';
import { SchemaMigrationService } from './schema-migration.service';
import { CrudRuntime } from './crud-runtime.service';
import { CrudDataService } from './crud-data.service';
import { BackendSmokeSensor } from '../../sensors/backend-smoke.sensor';
import { DeploymentService } from '../deployment/deployment.service';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';

describe('路 B 端到端验收 (集成, 需真 Postgres)', () => {
  let prisma: PrismaClient;
  let dbUp = false;
  let migration: SchemaMigrationService;
  let runtime: CrudRuntime;
  let crud: CrudDataService;
  let sensor: BackendSmokeSensor;
  let deployment: DeploymentService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      dbUp = true;
    } catch {
      dbUp = false;
      // eslint-disable-next-line no-console
      console.warn('[e2e] 无可用 Postgres，路 B 端到端验收跳过（设 TEST_DATABASE_URL 启用）');
    }
    migration = new SchemaMigrationService(prisma as never);
    runtime = new CrudRuntime(prisma as never, migration);
    crud = new CrudDataService(prisma as never);
    sensor = new BackendSmokeSensor(prisma as never, runtime as never, { health: jest.fn() } as never);
    deployment = new DeploymentService(prisma as never, { get: (_k: string, d: unknown) => d } as never, [], runtime as never);
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  const DATA_MODEL = `model Todo {
    id        String   @id @default(uuid())
    title     String
    done      Boolean  @default(false)
    createdAt DateTime @default(now())
  }`;

  it('数据模型 → 部署置备 → CRUD 真存 → 传感器健康/故障可感知', async () => {
    if (!dbUp) return;
    const user = await prisma.user.create({ data: { email: `e2e-${Date.now()}@acc.local`, hashedPassword: 'x' } });
    const org = await prisma.organization.create({ data: { name: 'e2e', slug: `e2e-${Date.now()}` } });
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        orgId: org.id,
        name: '路B验收',
        dataModel: DATA_MODEL,
        demoHtml: '<html><head></head><body><script>/*appData*/</script></body></html>',
      },
    });
    const pid = project.id;
    try {
      // 部署 → 置备 per-project schema
      const dep = await deployment.deploy(pid);
      expect(dep.backend?.resources).toEqual(['todo']);
      expect(dep.productionUrl).toContain(`/api/deploy/${pid}`);

      // 模拟已部署应用经 /api/app 后端（CrudDataService）真读写
      const created = await crud.create(pid, 'todo', { title: '买菜', done: false });
      expect((created.data as { id: string }).id).toBeTruthy();
      const id = (created.data as { id: string }).id;

      const list = await crud.list(pid, 'todo', {});
      expect(list.total).toBe(1);
      expect((list.data[0] as { title: string }).title).toBe('买菜');

      const upd = await crud.update(pid, 'todo', id, { done: true });
      expect((upd.data as { done: boolean }).done).toBe(true);

      // 传感器：健康
      const ok = await sensor.run(pid);
      expect(ok.passed).toBe(true);
      expect(ok.score).toBe(100);

      // 模拟后端故障：删表 → 传感器感知不可达
      await prisma.$executeRawUnsafe(`DROP TABLE "${migration.schemaNameFor(pid)}"."todo"`);
      const bad = await sensor.run(pid);
      expect(bad.passed).toBe(false);
      expect(bad.checks.some((c) => !c.passed)).toBe(true);
    } finally {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${migration.schemaNameFor(pid)}" CASCADE`);
      await prisma.deployment.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: pid } }).catch(() => undefined);
      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it('无数据模型项目 → 纯前端部署，传感器跳过满分', async () => {
    if (!dbUp) return;
    const user = await prisma.user.create({ data: { email: `e2e-${Date.now()}-2@acc.local`, hashedPassword: 'x' } });
    const org = await prisma.organization.create({ data: { name: 'e2e', slug: `e2e-${Date.now()}-2` } });
    const project = await prisma.project.create({
      data: { userId: user.id, orgId: org.id, name: '纯前端', demoHtml: '<html><body>静态</body></html>' },
    });
    try {
      const dep = await deployment.deploy(project.id);
      expect(dep.backend).toBeUndefined();
      const s = await sensor.run(project.id);
      expect(s.passed).toBe(true);
      expect(s.score).toBe(100);
    } finally {
      await prisma.deployment.deleteMany({ where: { projectId: project.id } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });
});
