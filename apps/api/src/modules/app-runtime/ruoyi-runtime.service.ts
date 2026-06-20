import { Injectable } from '@nestjs/common';
import { BackendRuntime, BackendRuntimeDescriptor, BackendHealth, ProvisionResult } from './backend-runtime.interface';
import { AppSpec } from './app-spec.types';
import { RuoyiGenTable, toRuoyiGenTable } from './ruoyi-mapping';
import { toMysqlCreateTable } from './ruoyi-ddl';
import { ensureFkColumns, genTableMeta, RuoyiGenTableMeta } from './ruoyi-relations';
import { RuoyiClient, RuoyiClientConfig } from './ruoyi-client.service';

/**
 * 若依底座运行时（ADR-0003）。实现 BackendRuntime 契约（与 CrudRuntime 同缝，仅换实现）。
 *
 * 已组装的 codegen 链（M2+M3b+M3c）：
 *   ddlFor(实体→MySQL建表) → [建表] → generateSources(经 RuoyiClient 驱动真若依 codegen 取源码)
 * 已实测：RuoyiClient 对真若依产 12 文件（见 ruoyi-client LIVE 测）。
 * 待 M3c-remaining：把源码塞回工程 Maven build+部署起 module + seed sys_role/menu/data_scope；
 *   provision 把整链(建表→codegen→build→部署)串起来。故 provision 仍诚实抛"待 M3c"，不假装能跑。
 * 不绑 BACKEND_RUNTIME 令牌（默认仍 CrudRuntime）。
 */
@Injectable()
export class RuoyiRuntime implements BackendRuntime {
  readonly kind = 'ruoyi' as const;

  constructor(private readonly client: RuoyiClient) {}

  /** 实体 → 若依 codegen 输入（gen_table_column）。含关系时子表补外键列。 */
  buildGenTables(spec: AppSpec): RuoyiGenTable[] {
    return ensureFkColumns(spec.entities, spec.relations).map((e) => toRuoyiGenTable(e));
  }

  /** 实体 → MySQL 建表 DDL（importTable 前置）。含关系时 child 表带外键列。 */
  ddlFor(spec: AppSpec): string[] {
    return ensureFkColumns(spec.entities, spec.relations).map((e) => toMysqlCreateTable(e));
  }

  /** 每个实体的若依 gen_table 模板配置（1—N 父表→主子表 sub，否则 crud）。供 editSave 推给若依。 */
  genTableMetas(spec: AppSpec): Array<{ table: string } & RuoyiGenTableMeta> {
    const withFk = ensureFkColumns(spec.entities, spec.relations);
    return withFk.map((e) => ({ table: e.table, ...genTableMeta(e, withFk, spec.relations ?? []) }));
  }

  /** 经 RuoyiClient 驱动真若依 codegen，按实体取源码：{ 表名: { 文件: 代码 } }。 */
  async generateSources(cfg: RuoyiClientConfig, spec: AppSpec): Promise<Record<string, Record<string, string>>> {
    const out: Record<string, Record<string, string>> = {};
    for (const e of spec.entities) {
      out[e.table] = await this.client.generate(cfg, e.table);
    }
    return out;
  }

  async provision(_projectId: string, _dataModel: string): Promise<ProvisionResult> {
    throw new Error('RuoyiRuntime.provision 待 M3c：建表→codegen(已通)→源码塞工程 build+部署起 module→seed RBAC/菜单/数据权限');
  }

  async health(_projectId: string, _descriptor: BackendRuntimeDescriptor): Promise<BackendHealth> {
    throw new Error('RuoyiRuntime.health 待 M3c：探活若依实例 + 各资源可达');
  }

  async teardown(_projectId: string, _descriptor: BackendRuntimeDescriptor): Promise<void> {
    throw new Error('RuoyiRuntime.teardown 待 M3c：拆租户/停实例');
  }
}
