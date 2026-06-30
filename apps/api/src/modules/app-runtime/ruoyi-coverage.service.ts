import { Injectable } from '@nestjs/common';
import { AppSpec } from './app-spec.types';

/**
 * 若依交付覆盖度量化（ADR-0016 切片1，需求交互引擎"覆盖式收敛"的地基）。
 *
 * 把"还差什么"量化成 0-100：按**若依交付的固定槽位**（实体/字段/关系/角色/数据范围/菜单/验收场景）
 * 算每槽覆盖度，逼出缺口。结构照抄 discovery `CompletenessChecker`（加权分 + 每槽状态 + gaps），
 * 但槽换成**交付槽**（CompletenessChecker 算的是通用发现槽：产品形态/规模/目标用户…）。
 *
 * **纯函数**：输入取已组装的 `AppSpec`（= 复用 app-spec-assembler 的产物）+ 验收场景；
 * 不碰 DB/不解析 dataModel（那是 assembler 的活），保证单测先行、秒级可验。
 * 组装（impure：parseAndValidate dataModel）由调用方/切片2 的端点做。
 */

export type SlotState = 'known' | 'partial' | 'missing';

export interface RuoyiCoverageReport {
  /** 覆盖度 0-100（加权） */
  coverage: number;
  perSlot: {
    entities: SlotState; // 业务对象
    fields: SlotState; // 对象字段
    relations: SlotState; // 对象间关系
    roles: SlotState; // 使用角色
    dataScope: SlotState; // 数据权限范围
    menus: SlotState; // 菜单/功能入口
    businessRules: SlotState; // 业务规则
    acceptanceScenarios: SlotState; // 验收场景
  };
  /** 业务可读的缺口清单（一屏选择题/进度条用，切片2） */
  gaps: string[];
}

/** 验收场景（与 specification dto 同构，只取覆盖度需要的字段） */
export interface AcceptanceScenarioLite {
  name?: string;
  given?: string;
  when?: string;
  then?: string;
  priority?: string;
}

/** 非业务字段（id + 若依/审计列）：算"字段"槽时排除，避免"只有 id 也算有字段"。 */
const NON_BUSINESS_FIELDS = new Set(
  ['id', 'createdat', 'updatedat', 'createtime', 'updatetime', 'createby', 'updateby', 'tenantid', 'delflag', 'remark', 'version'],
);

@Injectable()
export class RuoyiCoverageService {
  /** 各槽权重（按交付必填度：实体/字段重，菜单/关系/数据范围/验收轻）。和 = 100。 */
  private readonly WEIGHTS = {
    entities: 20,
    fields: 15,
    roles: 15,
    relations: 10,
    dataScope: 10,
    menus: 10,
    businessRules: 10,
    acceptanceScenarios: 10,
  };

  /** 按若依交付槽算覆盖度。spec=已组装 AppSpec；scenarios=structuredRequirement.acceptanceScenarios。 */
  evaluate(spec: AppSpec, scenarios: AcceptanceScenarioLite[] = []): RuoyiCoverageReport {
    const entities = spec?.entities ?? [];
    const relations = spec?.relations ?? [];
    const roles = spec?.roles ?? [];
    const menus = spec?.menus ?? [];
    const businessRules = spec?.businessRules ?? [];
    const gaps: string[] = [];

    // ① 实体：有没有业务对象
    const entitiesState: SlotState = entities.length > 0 ? 'known' : 'missing';
    if (entitiesState === 'missing') gaps.push('业务对象（要管理哪些数据，如客户/合同/设备）');

    // ② 字段：实体有没有真业务字段（非 id/审计列）
    const entitiesWithFields = entities.filter((e) =>
      (e.fields ?? []).some((f) => !f.isId && !NON_BUSINESS_FIELDS.has((f.name || '').toLowerCase())),
    ).length;
    let fieldsState: SlotState;
    if (entities.length === 0 || entitiesWithFields === 0) {
      fieldsState = 'missing';
    } else if (entitiesWithFields < entities.length) {
      fieldsState = 'partial';
    } else {
      fieldsState = 'known';
    }
    if (fieldsState === 'missing') gaps.push('业务对象的字段（每个对象记录哪些信息）');
    else if (fieldsState === 'partial') gaps.push('部分业务对象还没有字段（如「合同」要记金额/期限等）');

    // ③ 角色：谁来用
    const rolesState: SlotState = roles.length > 0 ? 'known' : 'missing';
    if (rolesState === 'missing') gaps.push('使用角色（谁来用，如管理员/普通员工）');

    // ④ 关系：恰 1 个实体 → 无可关系，不扣分（known）；0 实体 → 随空 spec missing（不另 push 缺口，
    //    可操作缺口是"先加业务对象"）；≥2 实体则有关系才 known。
    let relationsState: SlotState;
    if (entities.length === 1) {
      relationsState = 'known';
    } else if (entities.length === 0) {
      relationsState = 'missing';
    } else if (relations.length > 0) {
      relationsState = 'known';
    } else {
      relationsState = 'missing';
      gaps.push('业务对象之间的关系（如一个客户有多份合同）');
    }

    // ⑤ 数据权限范围：角色有没有"看哪些数据"的区分（全默认全部=没想清 → partial）
    let dataScopeState: SlotState;
    if (roles.length === 0) {
      dataScopeState = 'missing'; // 由"角色"槽提示，不重复 push
    } else if (roles.some((r) => r.dataScope && r.dataScope !== '1')) {
      dataScopeState = 'known';
    } else {
      dataScopeState = 'partial';
      gaps.push('数据权限范围（各角色能看哪些数据，如普通员工只看自己的）');
    }

    // ⑥ 菜单：有没有功能入口
    const menusState: SlotState = menus.length > 0 ? 'known' : 'missing';
    if (menusState === 'missing') gaps.push('菜单/功能入口（系统里有哪些可点的功能页）');

    // ⑦ 业务规则：审批、计算、状态流转、校验等生成/验收约束
    const businessRulesState: SlotState = businessRules.length > 0 ? 'known' : 'missing';
    if (businessRulesState === 'missing') gaps.push('业务规则（什么情况下要审批/校验/计算/预警）');

    // ⑧ 验收场景：有没有可判定的 Given-When-Then
    const completeScenarios = scenarios.filter((s) => s && s.given && s.when && s.then).length;
    let acceptanceState: SlotState;
    if (scenarios.length === 0) {
      acceptanceState = 'missing';
      gaps.push('验收场景（怎样算交付合格，给出几个「在…时，做…，应当…」）');
    } else if (completeScenarios === 0) {
      acceptanceState = 'partial';
      gaps.push('验收场景不完整（补全「前置 / 操作 / 预期结果」三段）');
    } else {
      acceptanceState = 'known';
    }

    const perSlot = {
      entities: entitiesState,
      fields: fieldsState,
      relations: relationsState,
      roles: rolesState,
      dataScope: dataScopeState,
      menus: menusState,
      businessRules: businessRulesState,
      acceptanceScenarios: acceptanceState,
    };

    let coverage = 0;
    for (const [slot, state] of Object.entries(perSlot) as [keyof typeof this.WEIGHTS, SlotState][]) {
      const w = this.WEIGHTS[slot];
      if (state === 'known') coverage += w;
      else if (state === 'partial') coverage += Math.floor(w * 0.5);
    }

    return { coverage, perSlot, gaps };
  }
}
