import { BackendSmokeSensor } from './backend-smoke.sensor';

describe('BackendSmokeSensor', () => {
  let sensor: BackendSmokeSensor;
  let prisma: { project: { findUnique: jest.Mock } };
  let backend: { health: jest.Mock };

  const descriptor = (resources: string[]) => ({
    backendRuntime: { kind: 'crud', schemaName: 'proj_x', resources, status: 'ready' },
  });

  beforeEach(() => {
    prisma = { project: { findUnique: jest.fn() } };
    backend = { health: jest.fn() };
    sensor = new BackendSmokeSensor(prisma as never, backend as never, { health: jest.fn() } as never);
  });

  it('无数据后端 → 跳过，满分通过，不调 health', async () => {
    prisma.project.findUnique.mockResolvedValue({ backendRuntime: null });
    const r = await sensor.run('p1');
    expect(r.passed).toBe(true);
    expect(r.score).toBe(100);
    expect(backend.health).not.toHaveBeenCalled();
  });

  it('全部资源可达 → 健康满分', async () => {
    prisma.project.findUnique.mockResolvedValue(descriptor(['todo', 'tag']));
    backend.health.mockResolvedValue({
      healthy: true,
      resources: [{ name: 'todo', reachable: true }, { name: 'tag', reachable: true }],
    });
    const r = await sensor.run('p1');
    expect(r.passed).toBe(true);
    expect(r.score).toBe(100);
    expect(r.checks).toHaveLength(2);
  });

  it('部分资源不可达 → 不健康，失败 check 标注资源名与原因', async () => {
    prisma.project.findUnique.mockResolvedValue(descriptor(['todo', 'tag']));
    backend.health.mockResolvedValue({
      healthy: false,
      resources: [{ name: 'todo', reachable: true }, { name: 'tag', reachable: false, detail: 'relation missing' }],
    });
    const r = await sensor.run('p1');
    expect(r.passed).toBe(false);
    expect(r.score).toBe(50);
    const fail = r.checks.find((c) => !c.passed)!;
    expect(fail.name).toContain('tag');
    expect(fail.detail).toBe('relation missing');
  });

  it('health 抛错 → 降级为失败 report，不向上抛', async () => {
    prisma.project.findUnique.mockResolvedValue(descriptor(['todo']));
    backend.health.mockRejectedValue(new Error('db down'));
    const r = await sensor.run('p1');
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
  });

  it('check weight < 25，避免触发 SensorService 的 critical 停迭代', async () => {
    prisma.project.findUnique.mockResolvedValue(descriptor(['todo']));
    backend.health.mockResolvedValue({ healthy: false, resources: [{ name: 'todo', reachable: false }] });
    const r = await sensor.run('p1');
    expect(r.checks.every((c) => c.weight < 25)).toBe(true);
  });
});
