import { Injectable, Logger } from '@nestjs/common';
import { BackendRuntime, BackendRuntimeDescriptor, BackendHealth, ProvisionResult, ProvisionPhase } from './backend-runtime.interface';
import { AppSpec } from './app-spec.types';
import { RuoyiGenTable, toRuoyiGenTable } from './ruoyi-mapping';
import { toMysqlCreateTable } from './ruoyi-ddl';
import { ensureFkColumns, genTableMeta, synthesizeJoinEntities, RuoyiGenTableMeta } from './ruoyi-relations';
import { ParsedModel } from './data-model.types';
import { RuoyiClient, RuoyiClientConfig } from './ruoyi-client.service';
import { loadRuoyiInstanceConfig } from './ruoyi-provision.config';
import type { ConsoleLabels } from './ruoyi-label-gen';

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
  /** 部署 codegen 源码并重启（importTable+[设中文标签]+下载→写工程→编译→重启，**不等就绪**）。RuoyiLocalDeployer.deploySources。 */
  deploySources(cfg: RuoyiClientConfig, tables: string[], labels?: ConsoleLabels): Promise<void>;
  /** 探活：轮询直到实例真就绪（收到非 5xx）。RuoyiLocalDeployer.waitReady。 */
  waitReady(): Promise<void>;
}

/**
 * 断点续跑端口：load 读上次完成相位，save 记录当前完成相位。默认 no-op（脚本/单测无需持久）。
 * 生产由 RuoyiProvisionService 用 prisma 落到 project.backendRuntime.phase——失败重跑跳过已完成步。
 */
export interface ProvisionCheckpoint {
  load(): Promise<ProvisionPhase>;
  save(phase: ProvisionPhase): Promise<void>;
}

const NOOP_CHECKPOINT: ProvisionCheckpoint = { load: async () => 'none', save: async () => undefined };
const PHASE_ORDER: ProvisionPhase[] = ['none', 'ddl', 'deployed', 'ready', 'seeded'];
/** 已完成相位 current 是否达到/越过 target（达到则该步可跳过）。 */
function phaseReached(current: ProvisionPhase, target: ProvisionPhase): boolean {
  return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(target);
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
  private readonly logger = new Logger(RuoyiRuntime.name);

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
   * 串完整链置备一个若依 App（M3c-remaining 实测流程的代码化，私有化档全自动），**支持断点续跑**：
   *   ① 建表 ② 部署源码+编译+重启 ②' 探活就绪 ③ seed 角色 ④ 返回 descriptor。
   * 每步完成记一个相位（checkpoint.save）；重跑从 checkpoint.load 的相位续，跳过已完成步——
   * 关键收益：探活超时落在 'deployed'，重跑只补 ②'+③，**不重编译**（编译/冷启 11~22min 最贵）。
   * 幂等：建表 `if not exists`、seedRoles 跳过已存在；不传 checkpoint 时退化为一次性全跑（脚本/单测）。
   */
  async provisionApp(
    projectId: string,
    spec: AppSpec,
    cfg: RuoyiClientConfig,
    infra: RuoyiProvisionInfra,
    checkpoint: ProvisionCheckpoint = NOOP_CHECKPOINT,
    labels: ConsoleLabels = {},
  ): Promise<ProvisionResult> {
    const entities = this.withRelations(spec);
    const tables = entities.map((e) => e.table);
    const from = await checkpoint.load();
    if (from !== 'none') this.logger.log(`provision 续跑 project=${projectId}：从相位 '${from}' 继续，跳过已完成步`);

    // ① 建表（含若依基础列 + 关系外键/中间表）
    if (!phaseReached(from, 'ddl')) {
      await infra.applyDdl(entities.map((e) => toMysqlCreateTable(e)));
      await checkpoint.save('ddl');
    }
    // ② 部署源码→单模块编译→重启（一次性，含全部表；最贵，断点续跑的关键不重做点）
    if (!phaseReached(from, 'deployed')) {
      await infra.deploySources(cfg, tables, labels);
      await checkpoint.save('deployed');
    }
    // ②' 探活就绪（与部署分相位：探活超时重跑只等就绪、不重编译）
    if (!phaseReached(from, 'ready')) {
      await infra.waitReady();
      await checkpoint.save('ready');
    }
    // ③ RBAC 运行时配：角色 + data_scope（'1'全部/'5'仅本人）+ 接口权限点（解生成 Controller 的 @SaCheckPermission 403）
    if (!phaseReached(from, 'seeded')) {
      if (spec.roles?.length) {
        const roleKeys = spec.roles.map((r, i) => roleKey(r.name, i));
        await this.client.seedRoles(
          cfg,
          spec.roles.map((r, i) => ({ roleName: r.name, roleKey: roleKeys[i], dataScope: r.dataScope })),
        );
        // 坎1：种控制台页菜单(C)+按钮权限点(F)并绑业务角色——否则控制台无导航/终端用户调接口被 @SaCheckPermission 挡 403。
        // labels 传入：C 菜单名用中文 functionName（ADR-0012 ①③）。
        await this.client.seedMenusAndGrant(cfg, tables, roleKeys, { labels });
      }
      await checkpoint.save('seeded');
    }
    // ④ descriptor（schemaName 复用租户号；resources = 暴露的表）
    return {
      descriptor: {
        kind: 'ruoyi',
        schemaName: cfg.tenantId,
        resources: tables,
        status: 'ready',
        provisionedAt: new Date().toISOString(),
      },
    };
  }

  async provision(_projectId: string, _dataModel: string): Promise<ProvisionResult> {
    throw new Error('RuoyiRuntime.provision 窄签名无法驱动若依（缺角色/菜单/实例配）；用 provisionApp(spec,cfg,infra)');
  }

  /**
   * 若依实例健康探活（ADR-0009 ③：上线门/传感器对若依分流——验运行的若依后端，不套路B schema 规则）。
   * 实例可达(HTTP 监听，401/200/302 皆算在跑) + 资源已置备(status=ready) → 资源可达。
   * 不用 schemaName 做 Postgres schema 校验（若依靠 tenant_id 隔离，schemaName=租户号数字开头）。
   */
  async health(_projectId: string, descriptor: BackendRuntimeDescriptor): Promise<BackendHealth> {
    const cfg = loadRuoyiInstanceConfig();
    const resources = descriptor.resources ?? [];
    if (!cfg.enabled) {
      return { healthy: false, resources: resources.map((r) => ({ name: r, reachable: false, detail: '未接入若依实例（缺 RUOYI_BASE_URL/RUOYI_SRC_ROOT）' })) };
    }
    let up = false;
    let detail = '';
    try {
      const res = await fetch(cfg.client.baseUrl, { signal: AbortSignal.timeout(5000) });
      up = res.status < 500; // 200/401/302 等都表示实例在监听
      detail = up ? `若依实例可达 (HTTP ${res.status})` : `若依实例异常 (HTTP ${res.status})`;
    } catch (e) {
      detail = `若依实例不可达: ${e instanceof Error ? e.message : e}`;
    }
    return {
      healthy: up && resources.length > 0,
      resources: resources.map((r) => ({ name: r, reachable: up, detail: up ? '若依模块已置备·实例可达' : detail })),
    };
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
