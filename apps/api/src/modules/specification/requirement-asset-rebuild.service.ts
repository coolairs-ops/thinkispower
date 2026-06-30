import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { assertResourceAccess } from '../../common/utils/tenant-scope';
import {
  buildPlanSeedFromRequirement,
  buildRequirementUplift,
  mergeRequirementUplift,
} from './requirement-uplift.service';
import { evaluateSpecificationGate } from './specification-gate';

interface RebuildCounts {
  roles: number;
  coreFunctions: number;
  dataModels: number;
  businessRules: number;
  acceptanceScenarios: number;
  pages: number;
}

@Injectable()
export class RequirementAssetRebuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statusMapper: StatusMapperService,
  ) {}

  async rebuildFromInterview(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        userId: true,
        orgId: true,
        name: true,
        description: true,
        status: true,
        structuredRequirement: true,
        planSummary: true,
      },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    const sr = asRecord(project.structuredRequirement);
    const answers = asInterviewAnswers((asRecord(sr.ideaInterview).answers));
    if (answers.length === 0) {
      throw new BadRequestException('没有可用于重建的访谈答案，请先完成需求访谈');
    }

    const uplift = buildRequirementUplift(answers, { projectName: project.name });
    const rebuiltRequirement = mergeRequirementUplift(sr, uplift, { projectName: project.name });
    const rebuiltPlan = buildPlanFromRequirement(rebuiltRequirement, project.planSummary);
    const specData = assembleSpecification(project.name, project.description, rebuiltPlan, rebuiltRequirement);
    const counts = countAssets(specData);

    const existingSpec = await this.prisma.specification.findUnique({ where: { projectId } });
    const nextVersion = (existingSpec?.version || 0) + 1;
    const changedAt = new Date().toISOString();
    const changeLog = [
      ...asArray(existingSpec?.changeLog),
      {
        version: nextVersion,
        changedAt,
        action: 'rebuild_from_interview',
        source: 'structuredRequirement.ideaInterview.answers',
        counts,
      },
    ];
    const changeLogJson = changeLog as never;
    const specPayload: any = { ...specData, changeLog: changeLogJson };

    const spec = await this.prisma.specification.upsert({
      where: { projectId },
      create: {
        projectId,
        version: nextVersion,
        status: 'draft',
        frozenAt: null,
        verificationResults: null,
        passRate: null,
        verifiedAt: null,
        ...specPayload,
      },
      update: {
        version: nextVersion,
        status: 'draft',
        frozenAt: null,
        verificationResults: null,
        passRate: null,
        verifiedAt: null,
        ...specPayload,
      },
    });

    this.statusMapper.assertValidTransition(project.status, 'spec_ready');
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        structuredRequirement: rebuiltRequirement as never,
        planSummary: rebuiltPlan as never,
        status: 'spec_ready',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('spec_ready'),
        specConfirmedAt: null,
      },
    });

    await this.prisma.projectMessage.create({
      data: {
        projectId,
        role: 'system_internal',
        content: `需求资产已从访谈答案重建：角色 ${counts.roles}、功能 ${counts.coreFunctions}、数据对象 ${counts.dataModels}、业务规则 ${counts.businessRules}、验收场景 ${counts.acceptanceScenarios}`,
        metadata: {
          action: 'requirement_asset_rebuild',
          source: 'structuredRequirement.ideaInterview.answers',
          specVersion: nextVersion,
          counts: { ...counts },
        } as never,
      },
    });

    return {
      success: true,
      message: '需求资产、方案和规格已重建，请重新确认规格',
      counts,
      plan: rebuiltPlan,
      specification: { ...spec, freezeGate: evaluateSpecificationGate(spec) },
    };
  }
}

function buildPlanFromRequirement(sr: Record<string, unknown>, existingPlan: unknown) {
  const seed = buildPlanSeedFromRequirement(sr);
  const existing = asRecord(existingPlan);
  return {
    ...existing,
    summary: seed.summary,
    pages: seed.pages,
    features: seed.features,
    roles: seed.roles,
    dataObjects: seed.dataObjects,
    acceptanceChecklist: seed.acceptanceChecklist,
    businessRules: asArray(sr.businessRules),
    acceptanceScenarios: asArray(sr.acceptanceScenarios),
    estimatedDays: toPositiveNumber(existing.estimatedDays) || estimateDays(seed.features.length, seed.pages.length),
    estimatedPriceRange: clean(existing.estimatedPriceRange) || '待评估',
  };
}

function assembleSpecification(name: string, description: string | null, plan: Record<string, unknown>, sr: Record<string, unknown>) {
  const prd = asRecord(sr.prd);
  const roleSource = firstNonEmptyArray(sr.roles, prd.roles, sr.targetUsers, prd.targetUsers, plan.roles);
  const functionSource = firstNonEmptyArray(sr.coreFunctions, prd.features, prd.mvpScope, plan.features);
  const pageSource = firstNonEmptyArray(sr.pages, prd.pages, plan.pages);
  const dataModelSource = firstNonEmptyArray(sr.dataModels, sr.dataObjects, prd.dataObjects, plan.dataObjects);
  const businessRuleSource = firstNonEmptyArray(sr.businessRules, plan.businessRules);
  const acceptanceSource = firstNonEmptyArray(sr.acceptanceScenarios, plan.acceptanceScenarios, plan.acceptanceChecklist, prd.successCriteria);
  return {
    targetUsers: roleSource.map((r: unknown) => ({ role: fieldOf(r, 'role', 'name'), description: fieldOf(r, 'description') })),
    coreFunctions: functionSource.map((f: unknown) => ({
      name: fieldOf(f, 'name'),
      description: fieldOf(f, 'description') || fieldOf(f, 'name'),
      priority: fieldOf(f, 'priority') || 'must',
    })),
    outOfScope: firstNonEmptyArray(sr.outOfScope, plan.outOfScope),
    pages: pageSource.map((p: unknown) => ({
      name: fieldOf(p, 'name'),
      route: fieldOf(p, 'route', 'path') || `/${slug(fieldOf(p, 'name'))}`,
      description: fieldOf(p, 'description'),
    })),
    roles: roleSource.map((r: unknown) => ({
      name: fieldOf(r, 'name', 'role'),
      permissions: arrayFieldOf(r, 'permissions', ['view']),
    })),
    dataModels: dataModelSource.map((d: unknown) => ({
      name: fieldOf(d, 'name'),
      fields: Array.isArray(asRecord(d).fields) && asArray(asRecord(d).fields).length > 0
        ? asArray(asRecord(d).fields)
        : [{ name: 'id', type: 'string', required: true }],
    })),
    businessRules: businessRuleSource.map((r: unknown) => ({
      name: fieldOf(r, 'name'),
      description: fieldOf(r, 'description') || fieldOf(r, 'name'),
      trigger: fieldOf(r, 'trigger') || '业务操作发生时',
      outcome: fieldOf(r, 'outcome') || '系统按规则处理并记录结果',
    })),
    acceptanceScenarios: acceptanceSource.map((s: unknown) => toAcceptanceScenario(s)),
    estimatedCostRmb: toPositiveNumber(plan.estimatedCostRmb) || null,
    estimatedDays: toPositiveNumber(plan.estimatedDays) || null,
    primaryRisks: firstNonEmptyArray(sr.primaryRisks, plan.risks),
  };
}

function countAssets(spec: Record<string, unknown>): RebuildCounts {
  return {
    roles: asArray(spec.roles).length,
    coreFunctions: asArray(spec.coreFunctions).length,
    dataModels: asArray(spec.dataModels).length,
    businessRules: asArray(spec.businessRules).length,
    acceptanceScenarios: asArray(spec.acceptanceScenarios).length,
    pages: asArray(spec.pages).length,
  };
}

function asInterviewAnswers(value: unknown): { question: string; answer: string }[] {
  return asArray(value)
    .map((item) => asRecord(item))
    .map((item) => ({ question: clean(item.question), answer: clean(item.answer) }))
    .filter((item) => item.question && item.answer);
}

function firstNonEmptyArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function fieldOf(value: unknown, key: string, altKey?: string): string {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  return clean(record[key]) || (altKey ? clean(record[altKey]) : '');
}

function arrayFieldOf(value: unknown, key: string, fallback: string[]): string[] {
  const record = asRecord(value);
  const raw = record[key];
  if (Array.isArray(raw) && raw.length > 0) return raw.map((item) => clean(item)).filter(Boolean);
  return fallback;
}

function toAcceptanceScenario(value: unknown) {
  if (typeof value === 'string') {
    const name = value.split(/[:：]/u)[0] || '验收场景';
    return { name, given: '用户已登录系统', when: value, then: '系统按预期完成并可验证', priority: 'must' };
  }
  return {
    name: fieldOf(value, 'name') || '验收场景',
    given: fieldOf(value, 'given') || '用户已登录系统',
    when: fieldOf(value, 'when') || '执行核心操作',
    then: fieldOf(value, 'then') || '系统按预期完成并可验证',
    priority: fieldOf(value, 'priority') || 'must',
  };
}

function estimateDays(features: number, pages: number): number {
  return Math.max(3, Math.min(20, Math.ceil(features * 1.5 + pages)));
}

function toPositiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function slug(value: string): string {
  return (value || 'page').trim().toLowerCase().replace(/\s+/g, '-');
}

function asRecord(value: unknown): Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
