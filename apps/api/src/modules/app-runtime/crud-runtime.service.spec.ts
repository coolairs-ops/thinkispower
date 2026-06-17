import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CrudRuntime } from './crud-runtime.service';
import { BackendRuntimeDescriptor } from './backend-runtime.interface';

describe('CrudRuntime', () => {
  let runtime: CrudRuntime;
  let prisma: { $queryRawUnsafe: jest.Mock; $executeRawUnsafe: jest.Mock; project: { update: jest.Mock } };
  let migration: { provision: jest.Mock };

  beforeEach(() => {
    prisma = {
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      project: { update: jest.fn().mockResolvedValue({}) },
    };
    migration = { provision: jest.fn() };
    runtime = new CrudRuntime(prisma as never, migration as never);
  });

  describe('provision', () => {
    it('置备建表并把 ready 描述符写回 Project', async () => {
      migration.provision.mockResolvedValue({ schemaName: 'proj_x', resources: ['todo', 'tag'], models: [] });
      const { descriptor } = await runtime.provision('p1', 'model Todo { id String @id }');

      expect(descriptor.kind).toBe('crud');
      expect(descriptor.status).toBe('ready');
      expect(descriptor.schemaName).toBe('proj_x');
      expect(descriptor.resources).toEqual(['todo', 'tag']);
      expect(descriptor.provisionedAt).toBeDefined();

      const arg = prisma.project.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'p1' });
      expect(arg.data.backendRuntime.schemaName).toBe('proj_x');
    });
  });

  describe('health', () => {
    const desc: BackendRuntimeDescriptor = { kind: 'crud', schemaName: 'proj_x', resources: ['a', 'b'], status: 'ready' };

    it('逐资源探活：一个可达一个失败 → 整体不健康', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ '?column?': 1 }]).mockRejectedValueOnce(new Error('relation missing'));
      const h = await runtime.health('p1', desc);
      expect(h.healthy).toBe(false);
      expect(h.resources).toEqual([
        { name: 'a', reachable: true },
        { name: 'b', reachable: false, detail: 'relation missing' },
      ]);
    });

    it('非法 schema 名拒绝', async () => {
      await expect(runtime.health('p1', { ...desc, schemaName: 'evil; DROP' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('teardown', () => {
    it('删 schema 并把描述符清为 DbNull', async () => {
      const desc: BackendRuntimeDescriptor = { kind: 'crud', schemaName: 'proj_x', resources: ['todo'], status: 'ready' };
      await runtime.teardown('p1', desc);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS "proj_x" CASCADE');
      expect(prisma.project.update.mock.calls[0][0].data.backendRuntime).toBe(Prisma.DbNull);
    });
  });
});
