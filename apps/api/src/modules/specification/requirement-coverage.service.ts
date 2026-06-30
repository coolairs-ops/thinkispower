import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SchemaMigrationService } from '../app-runtime/schema-migration.service';
import { AppSpecAssemblerService } from '../app-runtime/app-spec-assembler.service';
import { RuoyiCoverageService, RuoyiCoverageReport, AcceptanceScenarioLite } from '../app-runtime/ruoyi-coverage.service';
import { FollowUpQuestionService, FollowUpQuestion } from './followup-question.service';
import { ParsedModel } from '../app-runtime/data-model.types';
import { buildRequirementUplift, mergeRequirementUplift } from './requirement-uplift.service';

/**
 * 需求覆盖度聚合（ADR-0016 切片2）：把切片1 的若依交付覆盖度 + 现有 followup 业务选择题
 * 聚成一个端点，喂需求页"完备度 X% → 还差 N 项"进度条 + 缺口清单。
 *
 * - 覆盖度：组装 AppSpec（复用 app-spec-assembler，dataModel 空/不合法 → 容错按空实体，如实反映 missing）
 *   + structuredRequirement.acceptanceScenarios → RuoyiCoverageService.evaluate。
 * - 选择题：复用 FollowUpQuestionService.getQuestions（只读，无 LLM）。
 * 只读聚合，不写库、不调模型。
 */
export interface CoverageResponse extends RuoyiCoverageReport {
  questions: FollowUpQuestion[];
}

@Injectable()
export class RequirementCoverageService {
  private readonly logger = new Logger(RequirementCoverageService.name);

  constructor(
    private prisma: PrismaService,
    private schema: SchemaMigrationService,
    private assembler: AppSpecAssemblerService,
    private coverage: RuoyiCoverageService,
    private followup: FollowUpQuestionService,
  ) {}

  async getCoverage(userId: string, orgId: string | null, projectId: string): Promise<CoverageResponse> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, name: true, dataModel: true, structuredRequirement: true, planSummary: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    // 实体：dataModel 可能为空（早期）或不合法（建模中）→ 容错为空，覆盖度如实反映 entities/fields missing，不 500
    let entities: ParsedModel[] = [];
    if (project.dataModel?.trim()) {
      try {
        entities = this.schema.parseAndValidate(project.dataModel);
      } catch (e) {
        this.logger.warn(`coverage ${projectId}: dataModel 解析失败，按空实体算 — ${e instanceof Error ? e.message : e}`);
      }
    }

    let sr = (project.structuredRequirement as Record<string, unknown>) || {};
    const answers = Array.isArray((sr.ideaInterview as { answers?: unknown })?.answers)
      ? (sr.ideaInterview as { answers: { question: string; answer: string }[] }).answers
      : [];
    if (answers.length > 0) {
      sr = mergeRequirementUplift(sr, buildRequirementUplift(answers, { projectName: project.name }));
    }
    const plan = (project.planSummary as Record<string, unknown>) || {};
    const designEntities = entities.length > 0 ? entities : designEntitiesFromRequirement(sr, plan);
    const designSpec = this.assembler.assemble(designEntities, sr, project.planSummary);
    const scenarios = firstNonEmptyArray(plan.acceptanceScenarios, sr.acceptanceScenarios) as AcceptanceScenarioLite[];

    const report = this.coverage.evaluate(designSpec, scenarios);

    // followup 业务选择题（只读；失败不阻断进度条）
    let questions: FollowUpQuestion[] = [];
    try {
      ({ questions } = await this.followup.getQuestions(userId, orgId, projectId));
    } catch (e) {
      this.logger.warn(`coverage ${projectId}: followup 取题失败，略 — ${e instanceof Error ? e.message : e}`);
    }

    return { ...report, questions };
  }
}

export function designEntitiesFromRequirement(sr: Record<string, unknown>, plan: Record<string, unknown>): ParsedModel[] {
  const prd = (sr.prd && typeof sr.prd === 'object' && !Array.isArray(sr.prd)) ? sr.prd as Record<string, unknown> : {};
  const source = firstNonEmptyArray(sr.dataModels, plan.dataObjects, sr.dataObjects, prd.dataObjects);
  return source.map((item) => {
    const name = labelOf(item);
    const fields = Array.isArray((item as { fields?: unknown })?.fields)
      ? ((item as { fields: Array<Record<string, unknown>> }).fields)
      : [];
    return {
      name: toModelName(name),
      table: toTableName(name),
      fields: toParsedFields(fields),
    };
  }).filter((m) => m.name && m.table);
}

function firstNonEmptyArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function labelOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const r = value as { name?: unknown; role?: unknown; title?: unknown };
    return String(r.name ?? r.role ?? r.title ?? '').trim();
  }
  return '';
}

function toParsedFields(fields: Array<Record<string, unknown>>) {
  const raw = fields.length > 0 ? fields : [{ name: 'name', type: 'String', required: true }];
  return raw.map((f, index) => ({
    name: String(f.name ?? (index === 0 ? 'name' : `field${index}`)),
    prismaType: normalizePrismaType(String(f.prismaType ?? f.type ?? 'String')),
    optional: f.required === false,
    isId: String(f.name ?? '').toLowerCase() === 'id',
    isUnique: false,
  }));
}

function normalizePrismaType(type: string): string {
  if (/date|time/i.test(type)) return 'DateTime';
  if (/int/i.test(type)) return 'Int';
  if (/decimal|float|number|amount|money/i.test(type)) return 'Decimal';
  if (/bool/i.test(type)) return 'Boolean';
  if (/json/i.test(type)) return 'Json';
  return 'String';
}

function toModelName(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!clean) return '';
  if (isAscii(clean)) {
    return clean.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  }
  return clean;
}

function toTableName(name: string): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (ascii) return ascii;
  return `biz_${Buffer.from(name).toString('hex').slice(0, 12)}`;
}

function isAscii(value: string): boolean {
  return [...value].every((char) => char.charCodeAt(0) <= 127);
}
