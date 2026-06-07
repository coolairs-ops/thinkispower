import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { assertOrgAccess, TenantContext } from '../../common/utils/tenant-scope';
import { ParseSummary } from './import-parse.service';
import { ConflictDetectionService, RequirementConflict } from './conflict-detection.service';

/** 带溯源的合并条目：哪些来源资料提到了它 */
export interface MergedItem {
  name: string;
  sources: string[];
}

/**
 * 处理文档汇总（P15-2 第 4 步）：把一个批次内各份 AssetFile.parseSummary 合并成统一的
 * RequirementUnderstanding —— features/pages/roles 去重并内联溯源(哪份资料来的)，
 * positioning 综合各份概述，confidenceScore 由已理解占比给出。
 *
 * 纯代码合并(不再调 LLM)。冲突检测 + 置信度门控为后续 P15-7；flows 待原型解析 P15-5。
 */
@Injectable()
export class ImportUnderstandingService {
  constructor(
    private prisma: PrismaService,
    private conflictDetection: ConflictDetectionService,
  ) {}

  /** 汇总批次内已理解的资料，落 RequirementUnderstanding，并把批次推进到 ready_for_review */
  async summarize(ctx: TenantContext, batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { assets: true },
    });
    if (!batch) throw new NotFoundException('导入批次不存在');
    assertOrgAccess(batch.orgId, ctx.orgId, { allowLegacyNull: true });

    if (batch.assets.length === 0) {
      throw new BadRequestException('批次内无文件，无法生成需求理解');
    }

    const parsed = batch.assets
      .map((a) => ({ fileName: a.fileName, s: a.parseSummary as ParseSummary | null }))
      .filter((x): x is { fileName: string; s: ParseSummary } => x.s?.status === 'parsed');

    const features = this.merge(parsed, 'features');
    const pages = this.merge(parsed, 'pages');
    const roles = this.merge(parsed, 'roles');
    const suggestions = this.mergeSuggestions(parsed);
    const positioning =
      parsed.map((x) => x.s.summary).filter((v): v is string => !!v).join('；') || null;
    const confidenceScore = parsed.length / batch.assets.length;

    // 跨文档一致性：找出多份资料之间的矛盾/不一致/遗漏（P15-7）
    const conflicts = await this.conflictDetection.detect(
      ConflictDetectionService.fromParsed(parsed),
    );

    const data = {
      positioning,
      roles: roles as never,
      features: features as never,
      pages: pages as never,
      flows: [] as never,
      conflicts: conflicts as never,
      suggestions: suggestions as never,
      confidenceScore,
      status: 'draft' as const,
    };

    const understanding = await this.prisma.requirementUnderstanding.upsert({
      where: { batchId },
      create: { batchId, ...data },
      update: data,
    });

    // 据冲突刷新「待确认问题」（人在回路）
    await this.syncQuestions(understanding.id, conflicts);

    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'ready_for_review' },
    });

    return understanding;
  }

  /** 列出某批次需求理解的待确认问题（未解决在前） */
  async listQuestions(ctx: TenantContext, batchId: string) {
    const understanding = await this.prisma.requirementUnderstanding.findUnique({
      where: { batchId },
      include: { batch: { select: { orgId: true } } },
    });
    if (!understanding) return [];
    assertOrgAccess(understanding.batch.orgId, ctx.orgId, { allowLegacyNull: true });
    return this.prisma.requirementQuestion.findMany({
      where: { understandingId: understanding.id },
      orderBy: [{ resolved: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** 回答一个待确认问题（记录回答并标记 resolved，门控随之放行对应冲突） */
  async answerQuestion(ctx: TenantContext, questionId: string, answer: string) {
    const q = await this.prisma.requirementQuestion.findUnique({
      where: { id: questionId },
      include: { understanding: { include: { batch: { select: { orgId: true } } } } },
    });
    if (!q) throw new NotFoundException('待确认问题不存在');
    assertOrgAccess(q.understanding.batch.orgId, ctx.orgId, { allowLegacyNull: true });
    return this.prisma.requirementQuestion.update({
      where: { id: questionId },
      data: { answer, resolved: true },
    });
  }

  /** 据冲突刷新待确认问题：清掉未解决的旧问题，为 high/medium 冲突重建（已解决的保留为历史） */
  private async syncQuestions(understandingId: string, conflicts: RequirementConflict[]): Promise<void> {
    await this.prisma.requirementQuestion.deleteMany({ where: { understandingId, resolved: false } });
    const toAsk = conflicts.filter((c) => c.severity === 'high' || c.severity === 'medium');
    if (toAsk.length === 0) return;
    await this.prisma.requirementQuestion.createMany({
      data: toAsk.map((c) => ({ understandingId, question: this.questionText(c), severity: c.severity })),
    });
  }

  /** 把一处冲突渲染为给人看的待确认问题文案 */
  private questionText(c: RequirementConflict): string {
    const sev = c.severity === 'high' ? '高' : '中';
    const says = c.statements.map((s) => `${s.source}「${s.claim}」`).join('；');
    return `[${sev}冲突] ${c.topic}：${says}${c.suggestion ? ` —— ${c.suggestion}` : ''}`;
  }

  /** 合并各份的「建议补充」开放项，去重（不带溯源，作为统一的待补充清单） */
  private mergeSuggestions(parsed: Array<{ fileName: string; s: ParseSummary }>): string[] {
    const seen = new Set<string>();
    for (const { s } of parsed) {
      for (const raw of s.suggestions ?? []) {
        const v = raw.trim();
        if (v) seen.add(v);
      }
    }
    return [...seen];
  }

  /** 把各份笔记的某个数组字段按 name 去重合并，累积来源文件名 */
  private merge(
    parsed: Array<{ fileName: string; s: ParseSummary }>,
    field: 'features' | 'pages' | 'roles',
  ): MergedItem[] {
    const map = new Map<string, Set<string>>();
    for (const { fileName, s } of parsed) {
      for (const raw of s[field] ?? []) {
        const name = raw.trim();
        if (!name) continue;
        if (!map.has(name)) map.set(name, new Set());
        map.get(name)!.add(fileName);
      }
    }
    return [...map.entries()].map(([name, sources]) => ({ name, sources: [...sources] }));
  }
}
