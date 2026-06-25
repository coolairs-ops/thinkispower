import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SensorService } from '../../sensors/sensor.service';
import { LlmGatewayService } from '../../integrations/llm/llm-gateway.service';
import { FusedReport } from '../../sensors/sensor-report.interface';
import { assertResourceAccess } from '../../common/utils/tenant-scope';
import { inferFulfillment, Fulfillment } from '../../sensors/capability-provenance';
import { condenseHtmlForJudge } from '../../sensors/html-condense';

export type ScenarioStatus = 'pass' | 'fail' | 'manual';

/** 单条场景的验收结果：场景 → 来源 → 实现/检查 → 结果，可审计 */
export interface ScenarioVerification {
  scenarioName: string;
  given: string;
  when: string;
  then: string;
  priority: 'must' | 'nice';
  /** 覆盖的核心功能名 */
  coverage: string[];
  /** 来源资料(provenance)，从场景沿用 */
  provenance: string[];
  /** 能力来源(ADR-0008)：self 判 HTML / backend 认置备 / external·deferred 受控放行不计分 */
  fulfilledBy?: Fulfillment;
  status: ScenarioStatus;
  /** 逐条检查证据（语义判定 + 命中的传感器检查） */
  checks: Array<{ source: string; name: string; passed: boolean; detail?: string }>;
  /** 结论说明 */
  evidence: string;
  verifiedAt: string;
}

export interface AcceptanceReport {
  hasScenarios: boolean;
  passRate: number | null;
  total: number;
  passed: number;
  failed: number;
  manual: number;
  /** 平台级传感器总分(0-100)，作为实现质量旁证 */
  overallScore: number | null;
  scenarios: ScenarioVerification[];
  verifiedAt: string | null;
  specVersion: number | null;
}

/**
 * 验收报告服务（P15-Y 可验收/可追溯）。
 *
 * 把 Specification.acceptanceScenarios（带 provenance/coverage 的真实 GWT）逐条验收：
 * - 语义判定：用 LLM 对照 demoHtml/实现，判定每条场景 通过/未通过/待人工 + 证据；
 * - 传感器旁证：把 SensorService 的 FusedReport.checks 按 coverage 关键词聚合到对应场景；
 * - 计算 passRate，落库 verificationResults/passRate/verifiedAt，并写 changeLog 留痕。
 *
 * LLM 不可用时所有场景降级为「待人工」(manual)——不假阳性、不阻断，交人工裁定。
 */
@Injectable()
export class AcceptanceVerificationService {
  private readonly logger = new Logger(AcceptanceVerificationService.name);

  constructor(
    private prisma: PrismaService,
    private sensors: SensorService,
    private llm: LlmGatewayService,
  ) {}

  /** 执行验收：跑传感器 + 逐条语义判定，落库并返回报告 */
  async verify(userId: string, orgId: string | null, projectId: string): Promise<AcceptanceReport> {
    const { project, spec } = await this.load(userId, orgId, projectId);
    const scenarios = this.scenariosOf(spec);

    if (!spec || scenarios.length === 0) {
      return this.emptyReport(spec?.version ?? null);
    }

    // 1. 传感器：平台级实现质量信号（demo 完整性/运行时/语义等）
    let fused: FusedReport | null = null;
    try {
      fused = await this.sensors.runAll(projectId);
    } catch (e) {
      this.logger.warn(`传感器运行失败，验收转语义+人工: ${e}`);
    }

    // ADR-0008 D5：后端底座(若依)已置备 → backend 类场景按置备信用、不拿 HTML 判
    const backendReady = (project.backendRuntime as any)?.status === 'ready';

    // ADR-0009 ③-c：若依项目把"运行后端真实证据"（backend-smoke 实测可达的资源）喂给判定器，
    // 让 self 类场景据"后端真在跑+前端契约已接"判 UI 完整度，而非因"静态 HTML 看不到运行时"误判 manual。
    let backendEvidence = '';
    if (backendReady) {
      const beReport = fused?.reports?.find((r) => r.sensorName === 'L2-后端连通');
      const reach = (beReport?.checks ?? []).filter((c) => c.name.startsWith('数据资源') && c.passed).map((c) => c.name.replace('数据资源 ', ''));
      if (reach.length) {
        backendEvidence = `运行时实测(若依后端已就绪)：资源 ${reach.join('/')} 真实可达、数据接口(前端 appData → /api/app → 若依)真通；前端已按契约接入这些资源的读写。`;
      }
    }

    // 2. 逐条语义判定（批量一次 LLM；失败 → 全部待人工）
    const verdicts = await this.judge(scenarios, project.demoHtml ?? '', project.description ?? '', backendEvidence)
      .catch((e) => {
        this.logger.warn(`验收语义判定失败，场景降级待人工: ${e}`);
        return null;
      });

    const verifiedAt = new Date().toISOString();
    const results: ScenarioVerification[] = scenarios.map((s, i) => {
      const fulfilledBy = inferFulfillment(`${s.name} ${s.then}`).fulfilledBy;
      const v = verdicts?.[i];
      let status: ScenarioStatus;
      let evidence: string;
      if (fulfilledBy === 'backend') {
        // 后端底座能力：HTML 看不见 → 按置备信用，未置备记待人工（不假阳性）
        status = backendReady ? 'pass' : 'manual';
        evidence = backendReady ? '后端底座能力（若依已置备），按置备信用、不以 HTML 判' : '后端底座能力，待后端置备（HTML 不该判此项）';
      } else if (fulfilledBy === 'external') {
        // 外部能力：受控放行、非未实现，不计入通过率分母
        const protocol = inferFulfillment(`${s.name} ${s.then}`).protocol ?? 'generic';
        status = 'manual';
        evidence = `外部能力待对接（${protocol}）—— 受控放行、留标准端口+备忘录，非未实现，不计入通过率`;
      } else if (fulfilledBy === 'deferred') {
        status = 'manual';
        evidence = '本期不做 / 品类外，移出验收通过率分母';
      } else {
        // self：判 demo HTML（LLM 语义判定）
        status = v?.status ?? 'manual';
        evidence = v?.evidence
          ? v.evidence
          : verdicts
            ? '语义判定未给出明确结论，需人工确认'
            : '验收判定服务暂不可用，需人工确认';
      }
      const checks = this.collectChecks(s, fused, fulfilledBy === 'self' ? v?.evidence : evidence);
      return {
        scenarioName: s.name,
        given: s.given,
        when: s.when,
        then: s.then,
        priority: s.priority,
        coverage: s.coverage,
        provenance: s.provenance,
        fulfilledBy,
        status,
        checks,
        evidence,
        verifiedAt,
      };
    });

    const passRate = this.computePassRate(results);
    await this.persist(projectId, spec, results, passRate, verifiedAt, '系统验收');

    return this.toReport(results, passRate, fused?.overallScore ?? null, verifiedAt, spec.version);
  }

  /**
   * 交付门控：规格含验收场景时，通过率需达标(默认 0.8，可配 ACCEPTANCE_PASS_RATE_THRESHOLD)才放行。
   * - 无规格/无场景 → 放行(不阻断未走规格链路的项目)。
   * - 尚未验收 → 先执行一次验收再判定。
   */
  async gate(
    userId: string,
    orgId: string | null,
    projectId: string,
  ): Promise<{ allowed: boolean; passRate: number | null; threshold: number; report: AcceptanceReport }> {
    const threshold = this.threshold();
    const { spec } = await this.load(userId, orgId, projectId);
    if (!spec || this.scenariosOf(spec).length === 0) {
      return { allowed: true, passRate: null, threshold, report: this.emptyReport(spec?.version ?? null) };
    }

    const verified = ((spec.verificationResults as unknown as ScenarioVerification[]) ?? []).length > 0 && spec.passRate != null;
    const report = verified ? await this.getReport(userId, orgId, projectId) : await this.verify(userId, orgId, projectId);
    const passRate = report.passRate ?? 0;
    return { allowed: passRate >= threshold, passRate, threshold, report };
  }

  private threshold(): number {
    const v = Number(process.env['ACCEPTANCE_PASS_RATE_THRESHOLD']);
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.8;
  }

  /** 读取已落库的验收报告（不重算），供报告页展示 */
  async getReport(userId: string, orgId: string | null, projectId: string): Promise<AcceptanceReport> {
    const { spec } = await this.load(userId, orgId, projectId);
    if (!spec) throw new NotFoundException('规格不存在，请先生成规格');

    const results = (spec.verificationResults as unknown as ScenarioVerification[]) ?? [];
    const hasScenarios = this.scenariosOf(spec).length > 0;
    if (results.length === 0) {
      return { ...this.emptyReport(spec.version), hasScenarios };
    }
    return this.toReport(
      results,
      spec.passRate ?? this.computePassRate(results),
      null,
      spec.verifiedAt ? spec.verifiedAt.toISOString() : null,
      spec.version,
    );
  }

  /** 人工裁定单条「待人工/未通过」场景，回写状态并重算 passRate + changeLog */
  async manualConfirm(
    userId: string,
    orgId: string | null,
    projectId: string,
    scenarioName: string,
    status: ScenarioStatus,
    note?: string,
  ): Promise<AcceptanceReport> {
    const { spec } = await this.load(userId, orgId, projectId);
    if (!spec) throw new NotFoundException('规格不存在');
    const results = (spec.verificationResults as unknown as ScenarioVerification[]) ?? [];
    const target = results.find((r) => r.scenarioName === scenarioName);
    if (!target) throw new NotFoundException('验收场景不存在，请先执行验收');

    const verifiedAt = new Date().toISOString();
    target.status = status;
    target.checks = [
      ...target.checks.filter((c) => c.source !== '人工'),
      { source: '人工', name: '人工裁定', passed: status === 'pass', detail: note || `人工标记为 ${status}` },
    ];
    target.evidence = note ? `人工确认：${note}` : `人工确认为 ${status}`;
    target.verifiedAt = verifiedAt;

    const passRate = this.computePassRate(results);
    await this.persist(projectId, spec, results, passRate, verifiedAt, `人工裁定「${scenarioName}」→ ${status}`);

    return this.toReport(results, passRate, null, verifiedAt, spec.version);
  }

  // ───────────────────────── 内部 ─────────────────────────

  private async load(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, orgId: true, demoHtml: true, description: true, backendRuntime: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);

    const spec = await this.prisma.specification.findUnique({ where: { projectId } });
    return { project, spec };
  }

  private scenariosOf(spec: any): Array<{
    name: string; given: string; when: string; then: string;
    priority: 'must' | 'nice'; coverage: string[]; provenance: string[];
  }> {
    const raw = (spec?.acceptanceScenarios as any[]) ?? [];
    return raw
      .filter((s) => s && typeof s.name === 'string' && s.name)
      .map((s) => ({
        name: s.name,
        given: s.given ?? '',
        when: s.when ?? '',
        then: s.then ?? '',
        priority: s.priority === 'nice' ? 'nice' : 'must',
        coverage: Array.isArray(s.coverage) ? s.coverage.filter((c: unknown) => typeof c === 'string') : [],
        provenance: Array.isArray(s.provenance) ? s.provenance.filter((p: unknown) => typeof p === 'string') : [],
      }));
  }

  /**
   * 把 demo HTML 压成"可判定语义"再喂 LLM——去掉 `<style>` 主题/CSS 噪声（对'功能是否实现'判定无意义、白占预算），
   * 上限放宽到 36000：原 12000 会把靠后的页整段截掉 → 后半页(如多页 demo 的聊天/咨询页)被假判未实现/待人工。
   * 保留 HTML 结构 + `<script>`（appData 绑定是"接口存在"的证据）。
   */
  private condenseForJudge(html: string): string {
    return condenseHtmlForJudge(html);
  }

  /** 批量语义判定：返回与入参等长的 [{status, evidence}]；无法解析则返回 null(全部待人工) */
  private async judge(
    scenarios: Array<{ name: string; given: string; when: string; then: string }>,
    demoHtml: string,
    description: string,
    backendEvidence = '',
  ): Promise<Array<{ status: ScenarioStatus; evidence: string }> | null> {
    if (!demoHtml.trim()) return null; // 没有实现产物可判定 → 全部待人工

    const list = scenarios
      .map((s, i) => `${i + 1}. 【${s.name}】Given:${s.given} When:${s.when} Then:${s.then}`)
      .join('\n');

    const system =
      '你是独立的验收测试工程师。对照「产品实现(HTML)」逐条判定下列验收场景是否达成。' +
      '只输出一个 JSON 对象，不要解释或 markdown：\n' +
      '{"verdicts":[{"index":1,"status":"pass|fail|manual","evidence":"判定依据(指出实现中支持/缺失的具体证据)"}]}\n' +
      '判定标准：实现中能找到满足 Then 的明确证据→pass；明显缺失或与预期相悖→fail；' +
      '无法仅凭当前实现判断(需运行时/数据/人工核对)→manual。index 必须与场景编号一一对应、全部覆盖。' +
      (backendEvidence
        ? '\n重要：下方提供了「运行时后端证据」——后端真实在跑、所列资源的数据接口已实测真通、前端已按契约接入。'
        + '对依赖后端读写/列表/详情的场景，不要再因「静态 HTML 看不到运行时」判 manual；'
        + '请据「前端 UI 是否接入了该能力(有无对应表单/列表/详情)」+ 该后端证据综合判 pass/fail。'
        + '注意：后端证据只覆盖基础增删改查；聚合看板、引导流程、级联删除、跨实体关联展示、数据权限隔离等若 UI 未实现，仍应据实判 fail/manual，不可因后端在跑就放过。'
        : '');

    const raw = await this.llm.chat(
      'text-validator',
      { system, user: `验收场景：\n${list}\n\n产品实现(HTML，可能截断)：\n${this.condenseForJudge(demoHtml)}${backendEvidence ? '\n\n运行时后端证据：\n' + backendEvidence : ''}\n\n项目描述：${description.slice(0, 1000)}` },
      { temperature: 0.1, maxTokens: 2048 },
    );

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let parsed: { verdicts?: unknown };
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
    if (!Array.isArray(parsed.verdicts)) return null;

    const byIndex = new Map<number, { status: ScenarioStatus; evidence: string }>();
    for (const v of parsed.verdicts as any[]) {
      if (!v || typeof v.index !== 'number') continue;
      const status: ScenarioStatus = v.status === 'pass' ? 'pass' : v.status === 'fail' ? 'fail' : 'manual';
      byIndex.set(v.index, { status, evidence: typeof v.evidence === 'string' ? v.evidence : '' });
    }
    // 对齐到场景顺序，缺失的判定为待人工
    return scenarios.map((_, i) => byIndex.get(i + 1) ?? { status: 'manual', evidence: '未返回该场景判定' });
  }

  /** 把场景的语义判定 + 命中 coverage 关键词的传感器检查聚合为逐条证据 */
  private collectChecks(
    scenario: { coverage: string[] },
    fused: FusedReport | null,
    semanticEvidence?: string,
  ): ScenarioVerification['checks'] {
    const checks: ScenarioVerification['checks'] = [];
    if (semanticEvidence !== undefined) {
      checks.push({ source: 'L3-语义', name: '场景语义验证', passed: false, detail: semanticEvidence });
    }
    if (!fused) return checks;

    const keywords = scenario.coverage.map((c) => c.toLowerCase()).filter(Boolean);
    for (const report of fused.reports) {
      for (const c of report.checks) {
        const hay = `${c.name} ${c.detail ?? ''}`.toLowerCase();
        const hit = keywords.length > 0 && keywords.some((k) => hay.includes(k));
        // 命中 coverage 关键词的检查直接关联；否则只保留平台级关键检查作为旁证
        if (hit) {
          checks.push({ source: report.sensorName, name: c.name, passed: c.passed, detail: c.detail ?? c.error });
        }
      }
    }
    // 始终附一条平台级总分旁证
    checks.push({
      source: '传感器融合',
      name: '平台实现质量',
      passed: fused.passed,
      detail: `综合得分 ${fused.overallScore}/100（L1 ${fused.layer1Score} / L2 ${fused.layer2Score} / L3 ${fused.layer3Score}）`,
    });
    return checks;
  }

  /**
   * 通过率（ADR-0008 D5）：只对 self + backend 计分；external/deferred 受控放行、移出分母。
   * 旧数据无 fulfilledBy → 视为 self（向后兼容，口径与改造前一致）。
   * 全是 external/deferred（无可阻断项）→ 视为达标 1。
   */
  private computePassRate(results: ScenarioVerification[]): number {
    if (results.length === 0) return 0;
    const scored = results.filter((r) => (r.fulfilledBy ?? 'self') === 'self' || r.fulfilledBy === 'backend');
    if (scored.length === 0) return 1;
    const passed = scored.filter((r) => r.status === 'pass').length;
    return Math.round((passed / scored.length) * 1000) / 1000;
  }

  private async persist(
    projectId: string,
    spec: any,
    results: ScenarioVerification[],
    passRate: number,
    verifiedAt: string,
    reason: string,
  ): Promise<void> {
    const changeLog = (spec.changeLog as any[]) ?? [];
    changeLog.push({
      version: spec.version,
      changedAt: verifiedAt,
      action: 'acceptance-verify',
      reason,
      passRate,
      summary: `${results.filter((r) => r.status === 'pass').length}/${results.length} 通过`,
    });

    await this.prisma.specification.update({
      where: { projectId },
      data: {
        verificationResults: results as never,
        passRate,
        verifiedAt: new Date(verifiedAt),
        changeLog: changeLog as never,
      },
    });
  }

  private toReport(
    results: ScenarioVerification[],
    passRate: number | null,
    overallScore: number | null,
    verifiedAt: string | null,
    specVersion: number | null,
  ): AcceptanceReport {
    return {
      hasScenarios: true,
      passRate,
      total: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      failed: results.filter((r) => r.status === 'fail').length,
      manual: results.filter((r) => r.status === 'manual').length,
      overallScore,
      scenarios: results,
      verifiedAt,
      specVersion,
    };
  }

  private emptyReport(specVersion: number | null): AcceptanceReport {
    return {
      hasScenarios: false, passRate: null, total: 0, passed: 0, failed: 0, manual: 0,
      overallScore: null, scenarios: [], verifiedAt: null, specVersion,
    };
  }
}
