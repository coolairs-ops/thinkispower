import { Logger } from '@nestjs/common';
import { createConnection } from 'mysql2/promise';

/**
 * 若依 MySQL 建表驱动（provision 链 ① 的真实现，私有化档）。
 *
 * RuoyiRuntime.provisionApp 的 `infra.applyDdl` 落点：连若依实例的 MySQL，按顺序执行
 * `toMysqlCreateTable` 产的建表语句（已含若依基础列 + 关系外键/中间表）。建表语句 `if not exists` 幂等。
 * 连接配置 = 私有化档"那一套若依实例"的库（一实例一配）。每次开/关连接，不持久连接池
 * （provision 是低频长任务，简单可靠优先）。
 */
export interface RuoyiMysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export class RuoyiMysqlDdlDriver {
  private readonly logger = new Logger(RuoyiMysqlDdlDriver.name);

  constructor(private readonly cfg: RuoyiMysqlConfig) {}

  async applyDdl(statements: string[]): Promise<void> {
    if (!statements.length) return;
    const conn = await createConnection({
      host: this.cfg.host,
      port: this.cfg.port,
      user: this.cfg.user,
      password: this.cfg.password,
      database: this.cfg.database,
      multipleStatements: false,
    });
    try {
      for (const sql of statements) {
        await conn.query(sql);
      }
      this.logger.log(`若依建表完成：${statements.length} 条 DDL @ ${this.cfg.host}:${this.cfg.port}/${this.cfg.database}`);
    } finally {
      await conn.end();
    }
  }
}
