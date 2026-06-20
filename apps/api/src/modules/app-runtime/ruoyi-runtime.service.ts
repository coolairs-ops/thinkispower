import { Injectable } from '@nestjs/common';
import { BackendRuntime, BackendRuntimeDescriptor, BackendHealth, ProvisionResult } from './backend-runtime.interface';
import { AppSpec } from './app-spec.types';
import { RuoyiGenTable, toRuoyiGenTable } from './ruoyi-mapping';
import { toMysqlCreateTable } from './ruoyi-ddl';
import { ensureFkColumns, genTableMeta, synthesizeJoinEntities, RuoyiGenTableMeta } from './ruoyi-relations';
import { ParsedModel } from './data-model.types';
import { RuoyiClient, RuoyiClientConfig } from './ruoyi-client.service';

/**
 * provision 的两个基础设施驱动端口（M3c-remaining 端到端已手工证通的步骤的代码化）。
 * 这两步要碰若依实例的 MySQL 与工程文件系统/构建，故抽成可注入端口：
 *   - applyDdl：在若依 MySQL 执行建表 DDL（幂等）。
 *   - deploySources：把 codegen 源码写进若依工程 → 重编译模块 → 重启/热生效。
 *     （exploded 跑法下 = 写文件 + 单模块 mvn compile + 重启，无需 6min fat-jar repackage。）
 * provisionApp 只编排、不关心 infra 怎么实现；单测用 mock infra，生产接真实现。
 */
export interface RuoyiProvisionInfra {
  /** 在若依 MySQL 执行建表 DDL（幂等）。RuoyiMysqlDdlDriver 实现。 */
  applyDdl(statements: string[]): Promise<void>;
  /** 把这些表的 codegen 源码部署进若依实例并生效（importTable+下载→写工程→编译→重启）。RuoyiLocalDeployer 实现。 */
  deployTables(cfg: RuoyiClientConfig, tables: string[]): Promise<void>;
}

/**
 * 若依底座运行时（ADR-0003）。实现 BackendRuntime 契约（与 CrudRuntime 同缝，仅换实现）。
 *
 * codegen 链（M2+M3b+M3c，端到端实测通）：
 *   ddlFor(实体→MySQL建表，含若依基础列+关系) → applyDdl → generateSources(RuoyiClient 驱动真若依 codegen)
 *   → deploySources(写文件+编译+重启) → seedRoles(RBAC+data_scope) → descriptor
 * `provisionApp(spec,cfg,infra)` 是真编排；`provision(projectId,dataModel)`（BackendRuntime 窄签名，
 *   只有 Prisma 文本、无角色/菜单/实例配）仍抛错指向 provisionApp——不假装能从窄入参跑若依。
 * 不绑 BACKEND_RUNTIME 令牌（默认仍 CrudRuntime）。
 */
@Injectable()
export class RuoyiRuntime implements BackendRuntime {
  readonly kind = 'ruoyi' as const;

  constructor(private readonly client: RuoyiClient) {}

  /**
   * 关系增强后的完整实体集：原实体 + N—N 合成的中间表，再统一补 1—N/树 的外键列。
   * 所有 codegen 出口（gen_table / DDL / 模板配置）都从这一份算，确保中间表/外键一致。
   */
  private withRelations(spec: AppSpec): ParsedModel[] {
    const joins = synthesizeJoinEntities(spec.entities, spec.relations ?? []);
    return ensureFkColumns([...spec.entities, ...joins], spec.relations);
  }

  /** 实体 → 若依 codegen 输入（gen_table_column）。含关系时子表补外键、N—N 出中间表。 */
  buildGenTables(spec: AppSpec): RuoyiGenTable[] {
    return this.withRelations(spec).map((e) => toRuoyiGenTable(e));
  }

  /** 实体 → MySQL 建表 DDL（importTable 前置）。含关系时 child 带外键、N—N 出中间表。 */
  ddlFor(spec: AppSpec): string[] {
    return this.withRelations(spec).map((e) => toMysqlCreateTable(e));
  }

  /** 每个实体的若依 gen_table 模板配置（1—N 父表→sub，树→tree，中间表/其余→crud）。供 editSave 推给若依。 */
  genTableMetas(spec: AppSpec): Array<{ table: string } & RuoyiGenTableMeta> {
    const all = this.withRelations(spec);
    return all.map((e) => ({ table: e.table, ...genTableMeta(e, all, spec.relations ?? []) }));
  }

  /** 经 RuoyiClient 驱动真若依 codegen，按实体取源码：{ 表名: { 文件: 代码 } }。 */
  async generateSources(cfg: RuoyiClientConfig, spec: AppSpec): Promise<Record<string, Record<string, string>>> {
    const out: Record<string, Record<string, string>> = {};
    for (const e of spec.entities) {
      out[e.table] = await this.client.generate(cfg, e.table);
    }
    return out;
  }

  /**
   * 串完整链置备一个若依 App（M3c-remaining 实测流程的代码化，私有化档全自动）：
   *   ① 建表（含若依基础列 + 关系外键/中间表）② 部署（importTable+下载源码→写工程→编译→重启）
   *   ③ seed 角色 + 数据权限（运行时配，零重编译）④ 返回 descriptor。
   * 幂等：建表 `if not exists`、importTable 可重入、seedRoles 跳过已存在。
   */
  async provisionApp(
    projectId: string,
    spec: AppSpec,
    cfg: RuoyiClientConfig,
    infra: RuoyiProvisionInfra,
  ): Promise<ProvisionResult> {
    const entities = this.withRelations(spec);
    // ① 建表（含若依基础列 + 关系外键/中间表）
    await infra.applyDdl(entities.map((e) => toMysqlCreateTable(e)));
    // ② 部署：importTable+下载 codegen 源码→写工程→单模块编译→重启（一次性，含全部表）
    await infra.deployTables(cfg, entities.map((e) => e.table));
    // ③ RBAC 运行时配：角色 + data_scope（'1'全部/'5'仅本人）
    if (spec.roles?.length) {
      await this.client.seedRoles(
        cfg,
        spec.roles.map((r, i) => ({ roleName: r.name, roleKey: roleKey(r.name, i), dataScope: r.dataScope })),
      );
    }
    // ④ descriptor（schemaName 复用租户号；resources = 暴露的表）
    return {
      descriptor: {
        kind: 'ruoyi',
        schemaName: cfg.tenantId,
        resources: entities.map((e) => e.table),
        status: 'ready',
        provisionedAt: new Date().toISOString(),
      },
    };
  }

  async provision(_projectId: string, _dataModel: string): Promise<ProvisionResult> {
    throw new Error('RuoyiRuntime.provision 窄签名无法驱动若依（缺角色/菜单/实例配）；用 provisionApp(spec,cfg,infra)');
  }

  async health(_projectId: string, _descriptor: BackendRuntimeDescriptor): Promise<BackendHealth> {
    throw new Error('RuoyiRuntime.health 待 M3c：探活若依实例 + 各资源可达');
  }

  async teardown(_projectId: string, _descriptor: BackendRuntimeDescriptor): Promise<void> {
    throw new Error('RuoyiRuntime.teardown 待 M3c：拆租户/停实例');
  }
}

/** 角色名 → 若依 roleKey：取名字里的 ascii 字母数字小写；中文等取不出时退 `app_role_${序号}`。 */
function roleKey(name: string, index: number): string {
  const slug = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || `app_role_${index + 1}`;
}
