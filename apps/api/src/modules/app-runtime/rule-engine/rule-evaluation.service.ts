import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CrudDataService } from '../crud-data.service';
import { RuleEngineService } from './rule-engine.service';
import { RulePack, RuleDataContext, RuleEvalResult } from './rule-pack.types';

/** 项目 relations（关系补全 ADR-0003 M3c 存于 structuredRequirement.relations）的最小读取形状。 */
interface RelationLite {
  parent?: string;
  child?: string;
  fkField?: string;
}

/** 数据来源（provenance）：结论用到的某绑定实体的真实行从哪来——为 evidence_ref 真回指预留。 */
export interface DataProvenanceEntry {
  entity: string;
  /** 取数所用外键字段（关联到主体）；null=未找到关系、按空集处理 */
  via: string | null;
  /** 实际喂进引擎的真实记录 id 集合 */
  rowIds: string[];
  note?: string;
}

export interface LiveRuleEvalResult extends RuleEvalResult {
  /** 本次评估真实读取的数据来源，链回 CRUD 记录（契约B 接上后可再链回知识库源文档） */
  dataProvenance: DataProvenanceEntry[];
}

/**
 * 规则评估桥（Slice 0.5）：把规则引擎从"测试 fixture"接到**真实 CRUD 数据**。
 *
 * 守住上轮定的边界（契约A）：引擎只读 data_bindings 指向的**结构化实体**（CrudDataService），
 * 永不碰知识库。真实数据怎么进实体（契约B：抽取引擎/外部连接器）是独立轨道，不在此。
 *
 * 流程：查主体对象(crud.get) → 按 data_bindings 逐个取关联实体的相关行(crud.list，外键来自项目
 * relations，过滤到本主体) → 建 RuleDataContext + 记 provenance → 跑 8 步引擎 → 返结论+证据链+数据来源。
 */
@Injectable()
export class RuleEvaluationService {
  private readonly logger = new Logger(RuleEvaluationService.name);

  constructor(
    private prisma: PrismaService,
    private crud: CrudDataService,
    private engine: RuleEngineService,
  ) {}

  async evaluateObject(projectId: string, subjectResource: string, subjectId: string, now?: string): Promise<LiveRuleEvalResult> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { structuredRequirement: true } });
    const sr = (project?.structuredRequirement ?? {}) as Record<string, unknown>;
    const rulePack = sr.rulePack as RulePack | undefined;
    if (!rulePack) throw new NotFoundException('该项目未配置规则包（structuredRequirement.rulePack 为空）');
    const relations: RelationLite[] = Array.isArray(sr.relations) ? (sr.relations as RelationLite[]) : [];

    // 主体对象（如一家企业）
    const subjectRes = await this.crud.get(projectId, subjectResource, subjectId);
    const subject = (subjectRes.data ?? {}) as Record<string, unknown>;

    // 关联实体：按 data_bindings 逐个取真实行（外键来自 relations，过滤到本主体）
    const related: Record<string, Array<Record<string, unknown>>> = {};
    const dataProvenance: DataProvenanceEntry[] = [];
    for (const b of rulePack.data_bindings) {
      if (eqName(b.entity, subjectResource)) continue; // 主体本身不重复取
      const rel = relations.find((r) => eqName(r.parent, subjectResource) && eqName(r.child, b.entity) && !!r.fkField);
      if (!rel?.fkField) {
        related[b.entity] = [];
        dataProvenance.push({ entity: b.entity, via: null, rowIds: [], note: '未找到与主体的关系外键，按空集处理（需在关系补全/配置态指定）' });
        continue;
      }
      const list = await this.crud.list(projectId, b.entity, { filters: { [rel.fkField]: String(subjectId) }, pageSize: 100 });
      const rows = (list.data ?? []) as Array<Record<string, unknown>>;
      related[b.entity] = rows;
      dataProvenance.push({ entity: b.entity, via: rel.fkField, rowIds: rows.map((r) => String(r.id ?? '')).filter(Boolean) });
    }

    const ctx: RuleDataContext = { subject, related };
    const result = this.engine.evaluate(rulePack, ctx, now);
    this.logger.log(
      `规则评估 ${projectId}/${subjectResource}/${subjectId} → ${result.finalConclusions.map((c) => c.value).join(',') || '无结论'}` +
        `（数据来源 ${dataProvenance.map((p) => `${p.entity}:${p.rowIds.length}行`).join(' ') || '无关联'}）`,
    );
    return { ...result, dataProvenance };
  }
}

function eqName(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
