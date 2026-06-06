import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { assertOrgAccess, TenantContext } from '../../common/utils/tenant-scope';
import { ParseSummary } from './import-parse.service';

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
  constructor(private prisma: PrismaService) {}

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
    const positioning =
      parsed.map((x) => x.s.summary).filter((v): v is string => !!v).join('；') || null;
    const confidenceScore = parsed.length / batch.assets.length;

    const data = {
      positioning,
      roles: roles as never,
      features: features as never,
      pages: pages as never,
      flows: [] as never,
      conflicts: [] as never,
      confidenceScore,
      status: 'draft' as const,
    };

    const understanding = await this.prisma.requirementUnderstanding.upsert({
      where: { batchId },
      create: { batchId, ...data },
      update: data,
    });

    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'ready_for_review' },
    });

    return understanding;
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
