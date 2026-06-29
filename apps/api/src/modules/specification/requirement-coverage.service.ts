import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SchemaMigrationService } from '../app-runtime/schema-migration.service';
import { AppSpecAssemblerService } from '../app-runtime/app-spec-assembler.service';
import { RuoyiCoverageService, RuoyiCoverageReport, AcceptanceScenarioLite } from '../app-runtime/ruoyi-coverage.service';
import { FollowUpQuestionService, FollowUpQuestion } from './followup-question.service';
import { ParsedModel } from '../app-runtime/data-model.types';

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
      select: { userId: true, dataModel: true, structuredRequirement: true, planSummary: true },
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

    const spec = this.assembler.assemble(entities, project.structuredRequirement, project.planSummary);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    const plan = (project.planSummary as Record<string, unknown>) || {};
    const scenarios = ((plan.acceptanceScenarios as AcceptanceScenarioLite[]) ?? (sr.acceptanceScenarios as AcceptanceScenarioLite[]) ?? []);

    const report = this.coverage.evaluate(spec, scenarios);

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
