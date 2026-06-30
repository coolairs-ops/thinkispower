import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { assertResourceAccess } from '../../common/utils/tenant-scope';
import { SchemaMigrationService } from '../app-runtime/schema-migration.service';
import { AppSpecAssemblerService } from '../app-runtime/app-spec-assembler.service';
import { RuoyiCoverageService, AcceptanceScenarioLite } from '../app-runtime/ruoyi-coverage.service';
import { ParsedModel } from '../app-runtime/data-model.types';

export type GateStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export type DeliveryCheckMode = 'inspect' | 'package';

export interface DeliveryPackageCheckArgs {
  projectId?: string;
  mode?: DeliveryCheckMode;
  out?: string;
}

export interface Gate {
  key: string;
  name: string;
  status: GateStatus;
  summary: string;
  details?: Record<string, unknown>;
}

export interface DeliveryCheckReport {
  generatedAt: string;
  mode: DeliveryCheckMode;
  project: {
    id: string;
    name: string;
    lifecycleStatus: string;
    publicStatusLabel: string | null;
    updatedAt: string;
  };
  overall: {
    status: GateStatus;
    summary: string;
    blockers: string[];
    warnings: string[];
  };
  gates: {
    requirementCoverage: Gate;
    specification: Gate;
    demo: Gate;
    acceptance: Gate;
    ruoyiProvision: Gate;
    goLive: Gate;
    guardian: Gate;
  };
  artifacts: {
    productionUrl: string | null;
    demoUrl: string | null;
    latestBuild: unknown;
    reportJsonPath?: string;
    reportMarkdownPath?: string;
  };
}

@Injectable()
export class DeliveryPackageCheckService {
  constructor(
    private readonly prisma: PrismaService | PrismaClient,
    private readonly schema: SchemaMigrationService,
    private readonly assembler: AppSpecAssemblerService,
    private readonly coverageSvc: RuoyiCoverageService,
  ) {}

  async run(args: DeliveryPackageCheckArgs = {}): Promise<DeliveryCheckReport> {
    const mode = args.mode ?? 'inspect';
    const report = await this.buildReport({ projectId: args.projectId, mode });
    if (mode !== 'package') return report;

    const paths = this.writePackageReports(report, args.out);
    return this.withReportPaths(report, paths);
  }

  async runForUser(
    userId: string,
    orgId: string | null,
    projectId: string,
    args: Omit<DeliveryPackageCheckArgs, 'projectId'> = {},
  ): Promise<DeliveryCheckReport> {
    await this.assertProjectAccess(userId, orgId, projectId);
    return this.run({ ...args, projectId });
  }

  async attachReportToDeliveryDir(projectId: string, deliveryDir: string): Promise<DeliveryCheckReport> {
    const report = await this.buildReport({ projectId, mode: 'package' });
    const paths = this.writePackageReports(report, join(deliveryDir, 'delivery-check', 'delivery-check.json'));
    return this.withReportPaths(report, paths);
  }

  async buildReport(args: Pick<DeliveryPackageCheckArgs, 'projectId' | 'mode'> = {}): Promise<DeliveryCheckReport> {
    const mode = args.mode ?? 'inspect';
    const project = args.projectId
      ? await this.prisma.project.findUnique({ where: { id: args.projectId }, include: { specification: true } })
      : await this.prisma.project.findFirst({ orderBy: { updatedAt: 'desc' }, include: { specification: true } });

    if (!project) {
      throw new Error(args.projectId ? `项目不存在: ${args.projectId}` : '没有找到任何项目，请先创建项目或传 --projectId。');
    }

    const [latestBuild, latestGuardianCheck, pendingRemediations] = await Promise.all([
      this.prisma.build.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          version: true,
          status: true,
          sourceZipUrl: true,
          packageZipUrl: true,
          productionUrl: true,
          createdAt: true,
        },
      }),
      this.prisma.guardianCheck.findFirst({
        where: { projectId: project.id },
        orderBy: { checkedAt: 'desc' },
      }),
      this.prisma.guardianRemediation.findMany({
        where: { projectId: project.id, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const requirementCoverage = this.requirementCoverageGate(project);
    const specification = this.specificationGate(project.specification);
    const demo = this.demoGate(project);
    const acceptance = this.acceptanceGate(project.specification);
    const ruoyiProvision = this.ruoyiProvisionGate(project.backendRuntime);
    const goLive = this.goLiveGate(project, latestBuild);
    const guardian = this.guardianGate(project, latestGuardianCheck, pendingRemediations.length);

    const gates = { requirementCoverage, specification, demo, acceptance, ruoyiProvision, goLive, guardian };
    const all = Object.values(gates);
    const blockers = all.filter((g) => g.status === 'fail').map((g) => `${g.name}: ${g.summary}`);
    const warnings = all.filter((g) => g.status === 'warn' || g.status === 'unknown').map((g) => `${g.name}: ${g.summary}`);
    const overallStatus: GateStatus = blockers.length ? 'fail' : warnings.length ? 'warn' : 'pass';

    return {
      generatedAt: new Date().toISOString(),
      mode,
      project: {
        id: project.id,
        name: project.name,
        lifecycleStatus: project.status,
        publicStatusLabel: project.publicStatusLabel,
        updatedAt: project.updatedAt.toISOString(),
      },
      overall: {
        status: overallStatus,
        summary: overallStatus === 'pass'
          ? '交付包关键门全部通过'
          : overallStatus === 'fail'
            ? `存在 ${blockers.length} 个阻断项`
            : `存在 ${warnings.length} 个需关注项`,
        blockers,
        warnings,
      },
      gates,
      artifacts: {
        productionUrl: project.productionUrl,
        demoUrl: project.demoUrl,
        latestBuild: latestBuild ? withIsoDates(latestBuild) : null,
      },
    };
  }

  writePackageReports(report: DeliveryCheckReport, out?: string) {
    const safeProject = report.project.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const base = out
      ? this.resolveReportBase(out)
      : resolve(resolveApiRoot(), '.hermes', 'delivery-checks', safeProject, 'delivery-check');
    const jsonPath = base.endsWith('.json') ? base : `${base}.json`;
    const mdPath = jsonPath.replace(/\.json$/i, '.md');
    const reportWithPaths = this.withReportPaths(report, { jsonPath, mdPath });

    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(reportWithPaths, null, 2), 'utf8');
    writeFileSync(mdPath, this.renderMarkdown(reportWithPaths), 'utf8');
    return { jsonPath, mdPath };
  }

  renderMarkdown(report: DeliveryCheckReport): string {
    const lines: string[] = [];
    lines.push('# 思想动力交付包验收报告');
    lines.push('');
    lines.push(`- 项目：${report.project.name} (${report.project.id})`);
    lines.push(`- 模式：${report.mode}`);
    lines.push(`- 生成时间：${report.generatedAt}`);
    lines.push(`- 总体：${badge(report.overall.status)} ${report.overall.summary}`);
    lines.push('');
    lines.push('## 七道交付门');
    for (const gate of Object.values(report.gates)) {
      lines.push(`- ${badge(gate.status)} ${gate.name}：${gate.summary}`);
      const gaps = asArray(gate.details?.gaps);
      if (gaps.length) lines.push(`  缺口：${gaps.slice(0, 8).join('；')}${gaps.length > 8 ? `；另 ${gaps.length - 8} 项` : ''}`);
    }
    if (report.overall.blockers.length) {
      lines.push('');
      lines.push('## 阻断项');
      for (const item of report.overall.blockers) lines.push(`- ${item}`);
    }
    if (report.overall.warnings.length) {
      lines.push('');
      lines.push('## 关注项');
      for (const item of report.overall.warnings) lines.push(`- ${item}`);
    }
    lines.push('');
    lines.push('## 交付物');
    lines.push(`- productionUrl：${report.artifacts.productionUrl ?? '无'}`);
    lines.push(`- demoUrl：${report.artifacts.demoUrl ?? '无'}`);
    if (report.artifacts.reportJsonPath) lines.push(`- reportJson：${report.artifacts.reportJsonPath}`);
    if (report.artifacts.reportMarkdownPath) lines.push(`- reportMarkdown：${report.artifacts.reportMarkdownPath}`);
    return lines.join('\n');
  }

  private async assertProjectAccess(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, orgId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);
  }

  private requirementCoverageGate(project: {
    dataModel: string | null;
    structuredRequirement: unknown;
    planSummary: unknown;
    specification?: { acceptanceScenarios: unknown } | null;
  }): Gate {
    let entities: ParsedModel[] = [];
    let parseError: string | null = null;
    if (project.dataModel?.trim()) {
      try {
        entities = this.schema.parseAndValidate(project.dataModel);
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
    }

    const spec = this.assembler.assemble(entities, project.structuredRequirement, project.planSummary);
    const sr = asRecord(project.structuredRequirement);
    const plan = asRecord(project.planSummary);
    const scenarios = firstArray<AcceptanceScenarioLite>(
      plan.acceptanceScenarios,
      sr.acceptanceScenarios,
      project.specification?.acceptanceScenarios,
    );
    const coverage = this.coverageSvc.evaluate(spec, scenarios);
    const status: GateStatus = parseError
      ? 'warn'
      : coverage.coverage >= 90
        ? 'pass'
        : coverage.coverage >= 70
          ? 'warn'
          : 'fail';

    return {
      key: 'requirementCoverage',
      name: '需求覆盖',
      status,
      summary: `${coverage.coverage}% · 缺口 ${coverage.gaps.length} 项`,
      details: {
        coverage: coverage.coverage,
        perSlot: coverage.perSlot,
        gaps: coverage.gaps,
        parseError,
      },
    };
  }

  private specificationGate(spec: {
    version: number;
    status: string;
    frozenAt: Date | null;
    coreFunctions: unknown;
    pages: unknown;
    roles: unknown;
    dataModels: unknown;
    businessRules: unknown;
    acceptanceScenarios: unknown;
  } | null | undefined): Gate {
    if (!spec) {
      return { key: 'specification', name: '规格', status: 'fail', summary: '未生成规格' };
    }
    const counts = {
      coreFunctions: asArray(spec.coreFunctions).length,
      pages: asArray(spec.pages).length,
      roles: asArray(spec.roles).length,
      dataModels: asArray(spec.dataModels).length,
      businessRules: asArray(spec.businessRules).length,
      acceptanceScenarios: asArray(spec.acceptanceScenarios).length,
    };
    const status: GateStatus = spec.status === 'frozen' ? 'pass' : 'warn';
    return {
      key: 'specification',
      name: '规格',
      status,
      summary: `v${spec.version} · ${spec.status}${spec.frozenAt ? ` · frozenAt ${spec.frozenAt.toISOString()}` : ''}`,
      details: counts,
    };
  }

  private demoGate(project: {
    status: string;
    demoHtml: string | null;
    demoUrl: string | null;
    demoProgress: unknown;
    appSchema: unknown;
  }): Gate {
    const bytes = Buffer.byteLength(project.demoHtml ?? '', 'utf8');
    const schema = asRecord(project.appSchema);
    const pages = asArray(schema.pages);
    const hasDemo = bytes > 100;
    const status: GateStatus = hasDemo ? 'pass' : 'fail';
    return {
      key: 'demo',
      name: 'Demo',
      status,
      summary: hasDemo ? `${bytes} bytes · ${project.demoUrl ?? '无 demoUrl'}` : '未生成可用 demoHtml',
      details: {
        lifecycleStatus: project.status,
        demoUrl: project.demoUrl,
        bytes,
        appSchemaPages: pages.length,
        demoProgress: project.demoProgress ?? null,
      },
    };
  }

  private acceptanceGate(spec: {
    acceptanceScenarios: unknown;
    verificationResults: unknown;
    passRate: number | null;
    verifiedAt: Date | null;
  } | null | undefined): Gate {
    if (!spec) {
      return { key: 'acceptance', name: '验收', status: 'fail', summary: '无规格，无法验收' };
    }
    const scenarios = asArray(spec.acceptanceScenarios);
    const results = asArray<Record<string, unknown>>(spec.verificationResults);
    const counts = {
      total: results.length,
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      manual: results.filter((r) => r.status === 'manual').length,
    };
    if (scenarios.length === 0) {
      return {
        key: 'acceptance',
        name: '验收',
        status: 'fail',
        summary: '没有验收场景',
        details: { scenarios: 0, ...counts },
      };
    }
    if (!spec.verifiedAt || spec.passRate == null) {
      return {
        key: 'acceptance',
        name: '验收',
        status: 'warn',
        summary: `待执行验收 · 场景 ${scenarios.length} 个`,
        details: { scenarios: scenarios.length, ...counts },
      };
    }
    const status: GateStatus = spec.passRate >= 0.8 && counts.fail === 0 ? 'pass' : 'fail';
    return {
      key: 'acceptance',
      name: '验收',
      status,
      summary: `${Math.round(spec.passRate * 100)}% · pass ${counts.pass} / fail ${counts.fail} / manual ${counts.manual}`,
      details: {
        scenarios: scenarios.length,
        verifiedAt: spec.verifiedAt.toISOString(),
        passRate: spec.passRate,
        ...counts,
      },
    };
  }

  private ruoyiProvisionGate(backendRuntime: unknown): Gate {
    const be = asRecord(backendRuntime);
    if (!be.kind) {
      return { key: 'ruoyiProvision', name: '若依置备', status: 'warn', summary: '未指定若依底座', details: { backendRuntime: be } };
    }
    if (be.kind !== 'ruoyi') {
      return { key: 'ruoyiProvision', name: '若依置备', status: 'warn', summary: `当前后端: ${String(be.kind)}`, details: { backendRuntime: be } };
    }
    const status = String(be.status ?? 'unknown');
    const gateStatus: GateStatus = status === 'ready' ? 'pass' : status === 'error' ? 'fail' : 'warn';
    return {
      key: 'ruoyiProvision',
      name: '若依置备',
      status: gateStatus,
      summary: `${status} · 资源 ${asArray(be.resources).length} 个 · 项目账号 ${asArray(be.initialUsers).length} 个`,
      details: {
        status,
        phase: be.phase ?? null,
        resources: be.resources ?? [],
        schemaName: be.schemaName ?? null,
        provisionedAt: be.provisionedAt ?? null,
        initialUsers: asArray(be.initialUsers).map((u) => {
          const r = asRecord(u);
          return { userName: r.userName, role: r.role };
        }),
      },
    };
  }

  private goLiveGate(
    project: { goLiveStatus: string | null; productionUrl: string | null },
    latestBuild: { id: string; version: number; status: string; createdAt: Date; productionUrl: string | null } | null,
  ): Gate {
    const s = project.goLiveStatus ?? 'not_started';
    const status: GateStatus = s === 'completed'
      ? 'pass'
      : ['build_failed', 'contract_violation', 'smoke_failed', 'deploy_failed'].includes(s)
        ? 'fail'
        : 'warn';
    return {
      key: 'goLive',
      name: '上线门',
      status,
      summary: `${s} · ${project.productionUrl ?? '无 productionUrl'}`,
      details: {
        goLiveStatus: project.goLiveStatus,
        productionUrl: project.productionUrl,
        latestBuild: latestBuild ? withIsoDates(latestBuild) : null,
      },
    };
  }

  private guardianGate(
    project: { guardianEnabled: boolean; productionUrl: string | null },
    latest: { status: string; healthScore: number; passRate: number | null; checkedAt: Date; detail: unknown } | null,
    pendingRemediations: number,
  ): Gate {
    if (!project.productionUrl) {
      return { key: 'guardian', name: 'Guardian', status: 'warn', summary: '尚未上线，Guardian 未进入有效守护' };
    }
    if (!project.guardianEnabled) {
      return { key: 'guardian', name: 'Guardian', status: 'warn', summary: '未启用守护', details: { deployed: true } };
    }
    if (!latest) {
      return { key: 'guardian', name: 'Guardian', status: 'warn', summary: '已启用，但暂无巡检记录', details: { pendingRemediations } };
    }
    const status: GateStatus = latest.status === 'healthy'
      ? 'pass'
      : latest.status === 'critical'
        ? 'fail'
        : 'warn';
    return {
      key: 'guardian',
      name: 'Guardian',
      status,
      summary: `${latest.status} · ${latest.healthScore}/100 · ${latest.checkedAt.toISOString()}`,
      details: {
        enabled: project.guardianEnabled,
        latest: withIsoDates(latest),
        pendingRemediations,
      },
    };
  }

  private withReportPaths(report: DeliveryCheckReport, paths: { jsonPath: string; mdPath: string }): DeliveryCheckReport {
    return {
      ...report,
      artifacts: {
        ...report.artifacts,
        reportJsonPath: paths.jsonPath,
        reportMarkdownPath: paths.mdPath,
      },
    };
  }

  private resolveReportBase(out: string): string {
    return isAbsolute(out) ? out : resolve(resolveApiRoot(), out);
  }
}

export function resolveApiRoot(): string {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, 'prisma', 'schema.prisma'))) return cwd;
  if (existsSync(resolve(cwd, 'apps', 'api', 'prisma', 'schema.prisma'))) return resolve(cwd, 'apps', 'api');
  return cwd;
}

function badge(status: GateStatus): string {
  if (status === 'pass') return '[PASS]';
  if (status === 'warn') return '[WARN]';
  if (status === 'fail') return '[FAIL]';
  return '[UNKNOWN]';
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? v as T[] : [];
}

function firstArray<T>(...values: unknown[]): T[] {
  for (const v of values) {
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

function withIsoDates<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
