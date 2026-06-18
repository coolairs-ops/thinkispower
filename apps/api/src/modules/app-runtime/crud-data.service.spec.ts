import { NotFoundException } from '@nestjs/common';
import { CrudDataService } from './crud-data.service';

describe('CrudDataService', () => {
  let service: CrudDataService;
  let prisma: { $queryRawUnsafe: jest.Mock; project: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { $queryRawUnsafe: jest.fn(), project: { findUnique: jest.fn() } };
    service = new CrudDataService(prisma as never);
  });

  const withDescriptor = (resources = ['todo']) =>
    prisma.project.findUnique.mockResolvedValue({
      backendRuntime: { kind: 'crud', schemaName: 'proj_x', resources, status: 'ready' },
    });

  /** resolve 解析出 todo 表元数据：列 + 主键 */
  const withTableMeta = () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([
        { column_name: 'id', data_type: 'text' },
        { column_name: 'title', data_type: 'text' },
        { column_name: 'done', data_type: 'boolean' },
      ]) // information_schema.columns
      .mockResolvedValueOnce([{ pk: 'id' }]); // 主键
  };

  describe('校验 / 安全', () => {
    it('非法资源名直接拒绝，不查库', async () => {
      await expect(service.list('p1', '1evil; DROP', {})).rejects.toThrow(NotFoundException);
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });

    it('项目无后端描述符 → 资源不存在', async () => {
      prisma.project.findUnique.mockResolvedValue({ backendRuntime: null });
      await expect(service.list('p1', 'todo', {})).rejects.toThrow(NotFoundException);
    });

    it('资源不在白名单 → 拒绝', async () => {
      withDescriptor(['todo']);
      await expect(service.list('p1', 'other', {})).rejects.toThrow(NotFoundException);
    });

    it('资源名大小写不敏感：驼峰 dailyStats 解析到小写白名单 dailystats', async () => {
      withDescriptor(['dailystats']);
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ column_name: 'id', data_type: 'text' }]) // columns
        .mockResolvedValueOnce([{ pk: 'id' }]) // 主键
        .mockResolvedValueOnce([{ n: 0 }]) // count
        .mockResolvedValueOnce([]); // data

      await service.list('p1', 'dailyStats', {});

      // information_schema 用规范小写名查列
      expect(prisma.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual(['proj_x', 'dailystats']);
      // 数据查询用规范小写表名拼 ref（而非传入的驼峰）
      expect(prisma.$queryRawUnsafe.mock.calls[3][0]).toContain('"proj_x"."dailystats"');
    });
  });

  describe('list', () => {
    it('未知过滤列被忽略，已知列参数化进 WHERE，分页生效', async () => {
      withDescriptor();
      withTableMeta();
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ n: 1 }]) // count
        .mockResolvedValueOnce([{ id: '1', title: 'x' }]); // data

      const res = await service.list('p1', 'todo', {
        page: 2,
        pageSize: 10,
        sort: 'title:desc',
        filters: { title: 'x', 'evil; DROP': '1' },
      });

      expect(res).toEqual({ data: [{ id: '1', title: 'x' }], page: 2, pageSize: 10, total: 1 });

      const dataCall = prisma.$queryRawUnsafe.mock.calls[3];
      const sql = dataCall[0] as string;
      expect(sql).toContain('"title"::text = $1'); // 已知列进 WHERE
      expect(sql).not.toContain('evil'); // 未知列被忽略，绝不进 SQL
      expect(sql).toContain('ORDER BY "title" DESC');
      expect(sql).toContain('LIMIT $2 OFFSET $3');
      expect(dataCall.slice(1)).toEqual(['x', 10, 10]); // 值全部参数化，offset=(2-1)*10
    });

    it('pageSize 上限 100', async () => {
      withDescriptor();
      withTableMeta();
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ n: 0 }]).mockResolvedValueOnce([]);
      const res = await service.list('p1', 'todo', { pageSize: 9999 });
      expect(res.pageSize).toBe(100);
    });
  });

  describe('create', () => {
    it('只写入白名单列，未知字段被丢弃且不进 SQL', async () => {
      withDescriptor();
      withTableMeta();
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: '1', title: '买菜' }]); // INSERT RETURNING

      const res = await service.create('p1', 'todo', { title: '买菜', hacker: "'; DROP TABLE x; --" });
      expect(res.data).toEqual({ id: '1', title: '买菜' });

      const insert = prisma.$queryRawUnsafe.mock.calls[2];
      expect(insert[0]).toBe('INSERT INTO "proj_x"."todo" ("title") VALUES ($1) RETURNING *');
      expect(insert.slice(1)).toEqual(['买菜']); // 注入字符串作为参数值，不进 SQL 文本
    });
  });
});
