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

/** 实体关系（来自 relation-completion，回写在 structuredRequirement.relations）。
 *  parent/child 用实体名或表名（ruoyi-relations 按 name/table 忽略大小写匹配）。 */
export interface AppRelation {
  parent: string;
  child: string;
  cardinality: string; // '1-N' | '1-1' | 'N-N' | 'none'
  fkField?: string; // child 上的外键，如 storeId；树时为自外键 parentId
  tree?: boolean; // 自关联/树（parent===child）→ 若依 tree 模板
  joinTable?: string; // N—N 中间表名 → 合成中间表实体
  required?: boolean;
  onDelete?: string; // cascade | setNull | restrict
}

export interface AppBusinessRule {
  name: string;
  trigger?: string;
  outcome?: string;
}

export interface AppSpec {
  /** 实体模型（LLM 产 Prisma → ParsedModel），喂若依 codegen */
  entities: ParsedModel[];
  /** 角色 + 数据权限，运行时配进 sys_role */
  roles: AppRole[];
  /** 页面菜单，运行时配进 sys_menu */
  menus: AppMenu[];
  /** 实体关系（1—N 主子表）：补外键列 + 父表 sub-table codegen 配置 */
  relations?: AppRelation[];
  /** 业务规则：审批、计算、状态流转、校验等生成/验收约束 */
  businessRules?: AppBusinessRule[];
}
