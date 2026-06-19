import { Injectable } from '@nestjs/common';
import { BackendRuntime, BackendRuntimeDescriptor, BackendHealth, ProvisionResult } from './backend-runtime.interface';
import { AppSpec } from './app-spec.types';
import { RuoyiGenTable, toRuoyiGenTable } from './ruoyi-mapping';

/**
 * 若依底座运行时（ADR-0003 M2 骨架）。
 *
 * 实现 BackendRuntime 契约（与 CrudRuntime 同缝，B↔ruoyi 仅换实现，控制面/前端/传感器不改）。
 * M2 已实现：把 AppSpec.entities 映射成若依 codegen 输入（gen_table，纯确定性，已测）。
 * 待 M3：provision/health/teardown 接真若依——经 /tool/gen REST(importTable→editSave→preview)
 *        驱动 codegen + seed sys_role/sys_menu/data_scope + 起/连实例（私有化独立实例 / SaaS 多租户）。
 * 故本骨架不绑 BACKEND_RUNTIME 令牌（默认仍 CrudRuntime），只先把映射与契约形态立住。
 */
@Injectable()
export class RuoyiRuntime implements BackendRuntime {
  readonly kind = 'ruoyi' as const;

  /** 已实现：实体 → 若依 codegen 输入（gen_table_column）。M3 据此调 /tool/gen 自动生成。 */
  buildGenTables(spec: AppSpec): RuoyiGenTable[] {
    return spec.entities.map((e) => toRuoyiGenTable(e));
  }

  async provision(_projectId: string, _dataModel: string): Promise<ProvisionResult> {
    throw new Error('RuoyiRuntime.provision 待 M3：建表→importTable→editSave→preview 取码→塞工程 build+部署 + seed RBAC/菜单/数据权限');
  }

  async health(_projectId: string, _descriptor: BackendRuntimeDescriptor): Promise<BackendHealth> {
    throw new Error('RuoyiRuntime.health 待 M3：探活若依实例 + 各资源可达');
  }

  async teardown(_projectId: string, _descriptor: BackendRuntimeDescriptor): Promise<void> {
    throw new Error('RuoyiRuntime.teardown 待 M3：拆租户/停实例');
  }
}
