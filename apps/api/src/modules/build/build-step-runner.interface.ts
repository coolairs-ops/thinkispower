/**
 * 建造步骤执行器（ADR-0005）：编排器持有"回路"（确定性），把"有界的一步"委托给它。
 * 第一锤用默认占位实现；下一锤把 generate 接分段生成、test 接传感器/验收。
 */
export interface BuildModuleRef {
  id: string;
  name: string;
  spec: string | null;
}

export interface BuildStepRunner {
  /** 生成模块产物。ok=false 表示生成失败 → 模块 blocked。 */
  generate(projectId: string, module: BuildModuleRef): Promise<{ ok: boolean; summary?: string; result?: unknown }>;
  /** 测试门：passed=true 才算 done，否则 blocked。 */
  test(projectId: string, module: BuildModuleRef): Promise<{ passed: boolean; detail?: unknown }>;
}

export const BUILD_STEP_RUNNER = Symbol('BUILD_STEP_RUNNER');
