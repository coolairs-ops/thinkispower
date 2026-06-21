/**
 * 后端运行时契约（路 B 的核心抽象，约束② 的落点）。
 *
 * 同一个"项目后端"在不同档位有不同实现：
 *   - 路 B：`CrudRuntime`——平台内置的固定通用 CRUD 运行时（确定性、零 LLM 代码）。
 *   - 路 C：将换成"生成代码容器"实现。
 * 只要都实现本接口、遵守同一套 REST 约定（见 docs/architecture/app-runtime-rest-contract.md），
 * 前端调用 / 后端传感器 / 部署编排都无需改动——B↔C 仅替换实现。
 *
 * 注意：单条 CRUD 请求本身走 HTTP（REST 约定），不在本接口里；
 * 本接口只负责后端的"生命周期 + 自省"：置备 / 健康 / 拆除。
 */

/** 后端运行时类型：crud=固定运行时(B)；generated=生成代码容器(C，预留)；ruoyi=若依底座(ADR-0003，预留 M3 实现) */
export type BackendRuntimeKind = 'crud' | 'generated' | 'ruoyi';

/**
 * 若依 provision 的断点续跑相位（= 最后完成的步骤）。持久在 `descriptor.phase`。
 * 失败重跑据此跳过已完成步——尤其探活超时落在 'deployed' 时，重跑只等就绪、不重编译（编译/冷启是最贵的）。
 */
export type ProvisionPhase = 'none' | 'ddl' | 'deployed' | 'ready' | 'seeded';

/**
 * 单个项目应用的后端运行时描述符——持久在 `Project.backendRuntime`。
 * 它是"前端/传感器/部署"枚举后端能力的唯一真相源。
 */
export interface BackendRuntimeDescriptor {
  kind: BackendRuntimeKind;
  /** Postgres schema 命名空间，如 `proj_xxx`（per-project 隔离） */
  schemaName: string;
  /** 暴露的资源名（= 数据模型里的表名），供前端/传感器枚举 */
  resources: string[];
  status: 'provisioning' | 'ready' | 'error';
  provisionedAt?: string;
  error?: string;
  /** provision 断点续跑相位（仅置备中/失败时有意义；ready 终态可省）。失败重跑据此续。 */
  phase?: ProvisionPhase;
}

export interface ProvisionResult {
  descriptor: BackendRuntimeDescriptor;
}

/** 后端健康/连通自检结果，供后端传感器（slice 6）打分 */
export interface BackendHealth {
  healthy: boolean;
  resources: { name: string; reachable: boolean; detail?: string }[];
  detail?: string;
}

export interface BackendRuntime {
  readonly kind: BackendRuntimeKind;

  /** 按数据模型置备后端（建表/迁移等），必须幂等 */
  provision(projectId: string, dataModel: string): Promise<ProvisionResult>;

  /** 健康/连通自检，供后端传感器打分 */
  health(projectId: string, descriptor: BackendRuntimeDescriptor): Promise<BackendHealth>;

  /** 拆除（删 schema 等），用于项目重置/删除 */
  teardown(projectId: string, descriptor: BackendRuntimeDescriptor): Promise<void>;
}

/** DI 注入令牌：slice 4 起把 `CrudRuntime` 绑定到此 token；路 C 换绑生成容器实现 */
export const BACKEND_RUNTIME = Symbol('BACKEND_RUNTIME');
