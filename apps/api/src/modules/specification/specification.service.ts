import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { DeepseekService } from '../../services/deepseek.service';
import { CreateSpecDto, UpdateSpecDto, FreezeSpecDto } from './dto/spec.dto';
import { assertResourceAccess } from '../../common/utils/tenant-scope';
import {
  buildRequirementUplift,
  mergeRequirementUplift,
} from './requirement-uplift.service';
import { evaluateSpecificationGate } from './specification-gate';

@Injectable()
export class SpecificationService {
  private readonly logger = new Logger(SpecificationService.name);

  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
    private deepseek: DeepseekService,
  ) {}

  /** 从项目已有的 plan/discovery 数据自动生成初始规格草案 */
  async generateDraft(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, orgId: true, status: true, planSummary: true, structuredRequirement: true, description: true, name: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    // 检查是否已有规格
    const existing = await this.prisma.specification.findUnique({ where: { projectId } });
    if (existing && existing.status === 'frozen') {
      throw new BadRequestException('规格已确认，如需修改请先解冻');
    }

    // 状态转换
    this.statusMapper.assertValidTransition(project.status, 'spec_drafting');
    await this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'spec_drafting', publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('spec_drafting') },
    });

    // 基于现有 plan 和 discovery 数据组装规格草案
    const plan = project.planSummary as any;
    let sr = project.structuredRequirement as any;
    const answers = Array.isArray(sr?.ideaInterview?.answers) ? sr.ideaInterview.answers : [];
    if (answers.length > 0) {
      const uplift = buildRequirementUplift(answers, { projectName: project.name });
      sr = mergeRequirementUplift(sr, uplift, { projectName: project.name });
      await this.prisma.project.update({
        where: { id: projectId },
        data: { structuredRequirement: sr as any },
      });
    }

    // 如果数据不足，调用 AI 补全
    let specData: any;

    if (plan || sr) {
      specData = this.assembleFromExisting(project.name, project.description, plan, sr);
    } else {
      specData = await this.aiGenerateSpec(project.name, project.description || '');
    }

    // Upsert specification
    const spec = await this.prisma.specification.upsert({
      where: { projectId },
      create: {
        projectId,
        version: (existing?.version || 0) + 1,
        status: 'draft',
        ...specData,
      },
      update: {
        version: (existing?.version || 0) + 1,
        status: 'draft',
        ...specData,
      },
    });

    await this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'spec_ready', publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('spec_ready') },
    });

    return this.withFreezeGate({ ...spec, message: '规格草案已生成，请确认各项内容' });
  }

  /** 从已有数据组装规格 */
  private assembleFromExisting(name: string, description: string | null, plan: any, sr: any) {
    const prd = sr?.prd && typeof sr.prd === 'object' ? sr.prd : {};
    const roleSource = firstNonEmptyArray(plan?.roles, sr?.roles, prd?.roles, sr?.targetUsers, prd?.targetUsers);
    const functionSource = firstNonEmptyArray(plan?.features, sr?.coreFunctions, prd?.features, prd?.mvpScope);
    const pageSource = firstNonEmptyArray(plan?.pages, sr?.pages, prd?.pages);
    const dataModelSource = firstNonEmptyArray(plan?.dataObjects, sr?.dataModels, sr?.dataObjects, prd?.dataObjects);
    const businessRuleSource = firstNonEmptyArray(plan?.businessRules, sr?.businessRules);
    const acceptanceSource = firstNonEmptyArray(plan?.acceptanceScenarios, sr?.acceptanceScenarios, plan?.acceptanceChecklist, prd?.successCriteria);
    return {
      targetUsers: roleSource.map((r: any) => ({ role: fieldOf(r, 'role', 'name'), description: fieldOf(r, 'description') })),
      coreFunctions: functionSource.map((f: any) => ({
        name: fieldOf(f, 'name'),
        description: fieldOf(f, 'description'),
        priority: fieldOf(f, 'priority') || 'must',
      })),
      outOfScope: plan?.outOfScope || sr?.outOfScope || [],
      pages: pageSource.map((p: any) => ({
        name: fieldOf(p, 'name'),
        route: fieldOf(p, 'route', 'path') || `/${slug(fieldOf(p, 'name'))}`,
        description: fieldOf(p, 'description'),
      })),
      roles: roleSource.map((r: any) => ({
        name: fieldOf(r, 'name', 'role'),
        permissions: arrayFieldOf(r, 'permissions', ['view']),
      })),
      dataModels: dataModelSource.map((d: any) => ({
        name: fieldOf(d, 'name'),
        fields: Array.isArray(d?.fields) && d.fields.length > 0
          ? d.fields
          : [{ name: 'id', type: 'string', required: true }],
      })),
      businessRules: businessRuleSource.map((r: any) => ({
        name: fieldOf(r, 'name'),
        description: fieldOf(r, 'description') || fieldOf(r, 'name'),
        trigger: fieldOf(r, 'trigger') || '业务操作发生时',
        outcome: fieldOf(r, 'outcome') || '系统按规则处理并记录结果',
      })),
      acceptanceScenarios: acceptanceSource.map((s: any) => toAcceptanceScenario(s)),
      estimatedCostRmb: plan?.estimatedCostRmb || plan?.estimatedCost || sr?.estimatedCostRmb || null,
      estimatedDays: plan?.estimatedDays || plan?.estimatedDuration || sr?.estimatedDays || null,
      primaryRisks: plan?.risks || sr?.primaryRisks || [],
    };
  }

  /** AI 生成规格（数据不足时的降级方案） */
  private async aiGenerateSpec(name: string, description: string): Promise<any> {
    const prompt = `为以下项目生成产品规格草案（JSON 格式）：

项目名称：${name}
项目描述：${description || '无详细描述'}

返回 JSON，包含以下字段（只返回 JSON，不要额外说明）：
{
  "targetUsers": [{"role": "角色名", "description": "描述"}],
  "coreFunctions": [{"name": "功能名", "description": "描述", "priority": "must|nice|later"}],
  "outOfScope": [{"name": "暂不做功能", "reason": "原因"}],
  "pages": [{"name": "页面名", "route": "/route", "description": "描述"}],
  "roles": [{"name": "角色", "permissions": ["权限"]}],
  "dataModels": [{"name": "数据对象", "fields": [{"name": "字段", "type": "类型", "required": true|false}]}],
  "businessRules": [{"name": "规则名", "description": "描述", "trigger": "触发条件", "outcome": "结果"}],
  "acceptanceScenarios": [{"name": "场景", "given": "前置", "when": "操作", "then": "预期", "priority": "must|nice"}],
  "estimatedCostRmb": 估算金额(整数),
  "estimatedDays": 估算天数(整数),
  "primaryRisks": [{"name": "风险", "severity": "high|medium|low", "description": "说明"}]
}`;

    try {
      const response = await this.deepseek.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: 4096 },
      );
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      this.logger.warn(`AI spec generation failed: ${e}`);
    }
    // 降级骨架
    return this.assembleFromExisting(name, description, null, null);
  }

  /** 获取项目当前规格 */
  async getSpec(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true, name: true, status: true, specVersion: true, specConfirmedAt: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    const spec = await this.prisma.specification.findUnique({ where: { projectId } });
    if (!spec) {
      return {
        exists: false,
        projectName: project.name,
        status: project.status,
        message: '尚未生成规格草案',
        freezeGate: evaluateSpecificationGate(null),
      };
    }
    return this.withFreezeGate({ exists: true, projectName: project.name, ...spec });
  }

  /** 更新规格内容（draft 状态可编辑） */
  async updateSpec(userId: string, orgId: string | null, projectId: string, dto: UpdateSpecDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    let spec = await this.prisma.specification.findUnique({ where: { projectId } });
    if (!spec) throw new NotFoundException('规格不存在，请先生成');
    if (spec.status === 'frozen') throw new BadRequestException('规格已确认，不能直接编辑。请先解冻');

    // 记录变更历史
    const changeLog = (spec.changeLog as any[]) || [];
    const changedFields = Object.keys(dto).filter(k => (dto as any)[k] !== undefined);
    if (changedFields.length > 0) {
      changeLog.push({
        version: spec.version,
        changedAt: new Date().toISOString(),
        fields: changedFields,
      });
    }

    spec = await this.prisma.specification.update({
      where: { projectId },
      data: { ...dto, changeLog },
    });

    return this.withFreezeGate(spec);
  }

  /** 冻结/解冻规格 */
  async freezeSpec(userId: string, orgId: string | null, projectId: string, dto: FreezeSpecDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, orgId: true, status: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    const spec = await this.prisma.specification.findUnique({ where: { projectId } });
    if (!spec) throw new NotFoundException('规格不存在，请先生成');

    if (dto.action === 'confirm') {
      const gate = evaluateSpecificationGate(spec);
      if (!gate.readyToFreeze) {
        throw new BadRequestException(gate.freezeMessage);
      }

      if (spec.status === 'frozen') {
        // 已确认 → 幂等返回成功，让前端可以继续进入开发
        return { success: true, frozen: true, version: spec.version, message: '规格已确认，可以进入产品开发', freezeGate: gate };
      }

      // 冻结规格
      const frozenSpec = await this.prisma.specification.update({
        where: { projectId },
        data: { status: 'frozen', frozenAt: new Date() },
      });

      // 更新项目状态
      this.statusMapper.assertValidTransition(project.status, 'spec_confirmed');
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'spec_confirmed',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('spec_confirmed'),
          specVersion: spec.version,
          specConfirmedAt: new Date(),
        },
      });

      this.logger.log(`规格已确认: 项目 ${projectId} v${spec.version}`);
      return {
        success: true,
        frozen: true,
        version: spec.version,
        message: '规格已确认，可以进入产品开发',
        freezeGate: evaluateSpecificationGate(frozenSpec),
      };
    }

    // revise — 退回修改
    const revisedSpec = await this.prisma.specification.update({
      where: { projectId },
      data: {
        status: 'draft',
        version: spec.version + 1,
        changeLog: [...((spec.changeLog as any[]) || []), {
          version: spec.version + 1,
          changedAt: new Date().toISOString(),
          action: 'revise',
          note: dto.reviseNote || '用户要求修改',
        }],
      },
    });

    this.statusMapper.assertValidTransition(project.status, 'spec_ready');
    await this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'spec_ready', publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('spec_ready') },
    });

    return {
      success: true,
      frozen: false,
      version: spec.version + 1,
      message: '规格已解冻，可以修改',
      freezeGate: evaluateSpecificationGate(revisedSpec),
    };
  }

  private withFreezeGate<T extends Record<string, unknown>>(spec: T) {
    return { ...spec, freezeGate: evaluateSpecificationGate(spec) };
  }

  /** 规格确认后创建的新反馈，自动判定是 bug 还是变更请求 */
  isBugWithinSpec(spec: any, feedbackDescription: string): boolean {
    if (!spec || spec.status !== 'frozen') return true; // 未冻结规格的，全当 bug 处理

    const acceptanceScenarios = spec.acceptanceScenarios || [];
    const coreFunctions = spec.coreFunctions || [];
    const outOfScope = spec.outOfScope || [];

    const desc = feedbackDescription.toLowerCase();

    // 检查是否在验收场景内 → bug
    for (const s of acceptanceScenarios) {
      if (s.name && desc.includes(s.name.toLowerCase())) return true;
      if (s.then && desc.includes(s.then.toLowerCase())) return true;
    }

    // 检查是否属于核心功能 → bug
    for (const f of coreFunctions) {
      if (f.name && desc.includes(f.name.toLowerCase())) return true;
    }

    // 检查是否在暂不做范围内 → 变更请求
    for (const o of outOfScope) {
      if (o.name && desc.includes(o.name.toLowerCase())) return false;
    }

    // 默认：包含"新增""加一个""能不能"等关键词 → 变更请求
    const changeKeywords = ['新增', '加一个', '能不能', '再加', '能不能加', '增加', '添加一个'];
    for (const kw of changeKeywords) {
      if (desc.includes(kw)) return false;
    }

    return true; // 默认视为 bug
  }
}

function firstNonEmptyArray(...values: unknown[]): any[] {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function fieldOf(value: any, key: string, altKey?: string): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return String(value[key] ?? (altKey ? value[altKey] : '') ?? '').trim();
}

function arrayFieldOf(value: any, key: string, fallback: string[]): string[] {
  if (value && typeof value === 'object' && Array.isArray(value[key]) && value[key].length > 0) return value[key];
  return fallback;
}

function slug(value: string): string {
  return (value || 'page').trim().toLowerCase().replace(/\s+/g, '-');
}

function toAcceptanceScenario(value: any) {
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
