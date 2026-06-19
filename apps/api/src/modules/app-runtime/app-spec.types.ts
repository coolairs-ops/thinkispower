/**
 * 应用规格 AppSpec（ADR-0003 M2）：底座适配器 provision 的"富入参"。
 *
 * 现 BackendRuntime.provision 只收 Prisma 文本，对若依不够（还要角色/数据权限/菜单）。
 * AppSpec 把这几天需求补全（A/D/E + 回写）已产出的 IR 收成一份规格，喂给若依底座：
 *   - entities → 若依 codegen（gen_table_column，见 ruoyi-mapping.ts）
 *   - roles    → sys_role（运行时配，含数据权限 data_scope）
 *   - menus    → sys_menu（运行时配）
 * M3 把 provision 接成收 AppSpec；M2 先把类型定清楚，不改现有 CrudRuntime 签名。
 */
import { ParsedModel } from './data-model.types';

/** 若依数据权限范围 sys_role.data_scope：1全部 2自定义 3本部门 4本部门及以下 5仅本人 */
export type RuoyiDataScope = '1' | '2' | '3' | '4' | '5';

export interface AppRole {
  name: string;
  /** 来自需求补全 D 判出的"数据权限"缺口：管理员→'1'(全部)，普通用户→'5'(仅本人) */
  dataScope: RuoyiDataScope;
}

export interface AppMenu {
  name: string;
  path: string;
  /** 关联实体（菜单挂在哪个实体的 CRUD 上），可空（纯目录） */
  entity?: string;
}

export interface AppSpec {
  /** 实体模型（LLM 产 Prisma → ParsedModel），喂若依 codegen */
  entities: ParsedModel[];
  /** 角色 + 数据权限，运行时配进 sys_role */
  roles: AppRole[];
  /** 页面菜单，运行时配进 sys_menu */
  menus: AppMenu[];
}
