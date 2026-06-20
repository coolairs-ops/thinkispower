const mockQuery = jest.fn();
const mockEnd = jest.fn();
const mockCreateConnection = jest.fn(async (_cfg?: unknown) => ({ query: mockQuery, end: mockEnd }));
jest.mock('mysql2/promise', () => ({ createConnection: (c: unknown) => mockCreateConnection(c) }));

import { RuoyiMysqlDdlDriver } from './ruoyi-mysql-ddl.driver';

describe('RuoyiMysqlDdlDriver（若依建表驱动）', () => {
  const cfg = { host: '127.0.0.1', port: 3306, user: 'root', password: 'root', database: 'ry-vue' };

  beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue([{}]);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockCreateConnection.mockClear();
  });

  it('按顺序执行每条 DDL，用完关连接', async () => {
    const d = new RuoyiMysqlDdlDriver(cfg);
    await d.applyDdl(['create table a(...)', 'create table b(...)']);
    expect(mockCreateConnection).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', database: 'ry-vue' }));
    expect(mockQuery).toHaveBeenNthCalledWith(1, 'create table a(...)');
    expect(mockQuery).toHaveBeenNthCalledWith(2, 'create table b(...)');
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('空语句 → 不连库', async () => {
    await new RuoyiMysqlDdlDriver(cfg).applyDdl([]);
    expect(mockCreateConnection).not.toHaveBeenCalled();
  });

  it('某条 DDL 抛错 → 仍关连接（finally）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('bad sql'));
    await expect(new RuoyiMysqlDdlDriver(cfg).applyDdl(['boom'])).rejects.toThrow('bad sql');
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });
});
