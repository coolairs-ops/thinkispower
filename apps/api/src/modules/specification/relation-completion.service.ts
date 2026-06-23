import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { assertResourceAccess } from '../../common/utils/tenant-scope';

/**
 * 实体关系补全（relationship-completion-design.md）。
 * 把"实体关系"接进 A/D/回写流水线：检测候选关系(从已填证据推) → D 分类(autofill/ask) →
 * ask 出选择题(基数/级联) → 回写 structuredRequirement.relations → 喂若依子表 codegen。
 * 复用 requirement-completion 的成法（A/D/apply 同构）。
 *
 * 关系类型分阶段（设计 §6）：
 *   - Phase 2a｜1—N 主子表（已落）：parent 1 — N child，child 带外键。
 *   - Phase 2c｜自关联/树（本轮）：parent===child，child 带自外键(parentId)，喂若依 tree 模板。
 *   - Phase 2b｜N—N 多对多（本轮）：互为多，合成中间表实体喂 codegen。
 */

export type Cardinality = '1-N' | '1-1' | 'N-N' | 'none';
export type OnDelete = 'cascade' | 'setNull' | 'restrict';

export interface RelationQuestion {
  key: 'cardinality' | 'onDelete';
  question: string;
  options: { label: string; value: string }[];
}

/** 检测出的候选关系（含处置 + ask 选择题）。 */
export interface RelationCandidate {
  parent: string; // 一方，如 客户；树时 parent===child
  child: string; // 多方，如 项目
  cardinality: Cardinality;
  fkField?: string; // child 上的外键，如 customerId；树时为自外键 parentId
  tree?: boolean; // 自关联/树（部门树、分类树）：parent===child
  joinTable?: string; // N—N 中间表名（如 student_course）
  evidence?: string;
  source?: string; // field | page | design | flow | llm
  disposition: 'autofill' | 'ask';
  questions?: RelationQuestion[]; // 仅 ask
}

/** 回写后的确定关系（喂若依子表/树/中间表 codegen）。 */
export interface Relation {
  parent: string;
  child: string;
  cardinality: Cardinality;
  fkField?: string;
  tree?: boolean;
  joinTable?: string;
  required: boolean;
  onDelete: OnDelete;
  source?: string;
  confirmed: boolean;
}

const CARDINALITIES: Cardinality[] = ['1-N', '1-1', 'N-N', 'none'];
const ON_DELETES: OnDelete[] = ['cascade', 'setNull', 'restrict'];

@Injectable()
export class RelationCompletionService {
  private readonly logger = new Logger(RelationCompletionService.name);

  constructor(
    private prisma: PrismaService,
    private deepseek: DeepseekService,
  ) {}

  /** 检测候选关系（A+D 合一调用）：找有证据的 1—N 候选，明显→autofill，模糊→ask+选择题。存库+返回。 */
  async detect(userId: string, orgId: string | null, projectId: string): Promise<{ candidates: RelationCandidate[] }> {
    const project = await this.requireProject(userId, orgId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    const ctx = this.gatherContext(project.planSummary, sr);

    let candidates: RelationCandidate[] = [];
    try {
      const resp = await this.deepseek.chat([{ role: 'user', content: this.buildPrompt(ctx) }], {
        temperature: 0.3,
        maxTokens: 4096,
      });
      candidates = this.parse(resp);
    } catch (e) {
      this.logger.warn(`关系检测失败 ${projectId}: ${e instanceof Error ? e.message : e}`);
    }

    sr.relationCandidates = candidates as unknown;
    await this.prisma.project.update({ where: { id: projectId }, data: { structuredRequirement: sr as never } });
    const counts = candidates.reduce<Record<string, number>>((a, c) => ((a[c.disposition] = (a[c.disposition] || 0) + 1), a), {});
    this.logger.log(`关系检测 ${projectId}: ${candidates.length} 候选 ${JSON.stringify(counts)}`);
    return { candidates };
  }

  /** 取已存候选（不重新调模型）。 */
  async get(userId: string, orgId: string | null, projectId: string): Promise<{ candidates: RelationCandidate[]; relations: Relation[] }> {
    const project = await this.requireProject(userId, orgId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    return {
      candidates: (sr.relationCandidates as RelationCandidate[]) ?? [],
      relations: (sr.relations as Relation[]) ?? [],
    };
  }

  /**
   * 回写：autofill 候选默认成关系；ask 候选按 answers 定案（answers 键= `${parent}->${child}`）。
   * cardinality=none 的丢弃。结果写 structuredRequirement.relations。
   */
  async apply(
    userId: string,
    orgId: string | null,
    projectId: string,
    answers: Record<string, { cardinality?: string; onDelete?: string; required?: boolean }> = {},
  ): Promise<{ relations: Relation[] }> {
    const project = await this.requireProject(userId, orgId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    const candidates = (sr.relationCandidates as RelationCandidate[]) ?? [];

    const relations: Relation[] = [];
    for (const c of candidates) {
      const ans = answers[`${c.parent}->${c.child}`] || {};
      const cardinality = c.disposition === 'ask' ? this.pick(ans.cardinality, CARDINALITIES, c.cardinality) : c.cardinality;
      if (cardinality === 'none') continue; // 客户答"没关系"→丢弃
      const onDelete = this.pick(ans.onDelete, ON_DELETES, 'restrict');
      relations.push({
        parent: c.parent,
        child: c.child,
        cardinality,
        fkField: c.fkField,
        tree: c.tree || undefined,
        joinTable: c.joinTable,
        required: ans.required ?? true,
        onDelete,
        source: c.source,
        confirmed: true,
      });
    }

    sr.relations = relations as unknown;
    await this.prisma.project.update({ where: { id: projectId }, data: { structuredRequirement: sr as never } });
    this.logger.log(`关系回写 ${projectId}: ${relations.length} 条确定关系`);
    return { relations };
  }

  // ─── 内部 ───

  private pick<T extends string>(val: string | undefined, allowed: T[], fallback: T): T {
    return allowed.includes(val as T) ? (val as T) : fallback;
  }

  private gatherContext(planSummary: unknown, sr: Record<string, unknown>): { entities: string[]; pages: string[]; features: string[]; designSuggestions: string[] } {
    const plan = (planSummary as Record<string, unknown>) || {};
    const names = (raw: unknown): string[] =>
      Array.isArray(raw) ? raw.map((x) => (typeof x === 'string' ? x : (x as { name?: string } | null)?.name || '')).filter(Boolean) : [];
    // 优先用「已采纳」的设计建议作关系证据（采纳后的设计才是确定的、最全面的，关系问答据此最准）；
    // 若一条都没采纳则退回全部，避免空证据。
    const dsAll = (sr.designSuggestions as Array<{ title?: string; description?: string; adopted?: boolean }> | undefined) ?? [];
    const adopted = dsAll.filter((s) => s.adopted);
    const ds = adopted.length ? adopted : dsAll;
    return {
      entities: names(plan.dataObjects),
      pages: names(plan.pages),
      features: names(plan.features),
      designSuggestions: ds.map((s) => `${s.title || ''}：${s.description || ''}`).filter((s) => s !== '：'),
    };
  }

  private buildPrompt(ctx: { entities: string[]; pages: string[]; features: string[]; designSuggestions: string[] }): string {
    return `# 角色
你是资深B端需求分析师。从下面客户已填的实体/页面/功能/设计里，**找出实体之间可能的关系**。
覆盖三类：① 一对多(1-N，如 客户有多个项目) ② 多对多(N-N，如 学生选多门课、一门课多个学生) ③ 自关联/树(同一实体自己嵌套自己，如 部门有上级部门、商品分类有父分类)。
**只找有证据的**，不穷举所有实体对、不凭空发明。

# 输入
- 实体：${ctx.entities.join('、') || '（无）'}
- 页面：${ctx.pages.join('、') || '（无）'}
- 功能：${ctx.features.join('、') || '（无）'}
- 设计：${ctx.designSuggestions.slice(0, 8).join('；') || '（无）'}

# 任务（每条候选）
1. 定 parent / child 与 cardinality：
   - 1-N：parent(一方)/child(多方)，推测 child 外键字段名(如 customerId)。
   - N-N：互为多，给 cardinality="N-N" 并取一个中间表名 joinTable(英文小写下划线，如 student_course)。
   - 树：自己嵌套自己 → parent 与 child 填同一实体、tree=true、cardinality="1-N"、fkField 取自外键名(如 parentId)。
2. 给 evidence(来自哪个页面/字段/设计) + source(field|page|design|flow|llm)。
3. 判 disposition：
   - "autofill"：证据强、关系明显（如页面明写"客户详情含关联项目列表"、"部门含上级部门"）→ 默认无需问。
   - "ask"：基数模糊 / 是否多对多 / 是否必属 / 级联行为不明 → 出给非技术用户的选择题。
4. ask 时给两道选择题：基数(能一对多/多对多/没关系) + 级联(删 parent 时 child 怎么办)。
   - 树的级联题问"删除上级时，下级怎么办"。

# 约束
- 宁少而准。问题用非技术、口语化的话。
- 树：parent 与 child 必须是同一个实体名，且 tree=true。

# 输出（严格JSON数组，无任何额外文字/markdown围栏）
[{"parent":"客户","child":"项目","cardinality":"1-N","fkField":"customerId","evidence":"客户详情页含关联项目列表","source":"page","disposition":"autofill"},
{"parent":"部门","child":"部门","cardinality":"1-N","tree":true,"fkField":"parentId","evidence":"部门含上级部门","source":"field","disposition":"autofill"},
{"parent":"学生","child":"课程","cardinality":"N-N","joinTable":"student_course","evidence":"功能含学生选课、一门课多个学生","source":"feature","disposition":"ask","questions":[
  {"key":"cardinality","question":"一个【学生】能选多门【课程】、同一门【课程】也能被多个【学生】选吗？","options":[{"label":"能,多对多","value":"N-N"},{"label":"一个学生只对一门课","value":"1-N"},{"label":"它俩没关系","value":"none"}]},
  {"key":"onDelete","question":"删除【学生】时，他的选课记录怎么办？","options":[{"label":"一起删掉","value":"cascade"},{"label":"保留但解除关联","value":"setNull"},{"label":"不许删有选课的学生","value":"restrict"}]}
]}]`;
  }

  /** 健壮解析：去围栏→抽数组→过滤合法项。 */
  private parse(resp: string): RelationCandidate[] {
    if (!resp) return [];
    const m = resp.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      const arr = JSON.parse(m[0]) as unknown[];
      return arr
        .filter((c): c is RelationCandidate => !!c && typeof (c as RelationCandidate).parent === 'string' && typeof (c as RelationCandidate).child === 'string')
        .slice(0, 20)
        .map((c) => {
          // 树：模型给了 tree=true，或 parent===child（同实体自嵌套即树）。
          const tree = c.tree === true || c.parent === c.child;
          return {
            parent: c.parent,
            child: c.child,
            // 树强制 1-N（一个上级有多个下级）；其余按白名单，非法降级 1-N。
            cardinality: tree ? ('1-N' as Cardinality) : CARDINALITIES.includes(c.cardinality) ? c.cardinality : '1-N',
            fkField: c.fkField,
            tree: tree || undefined,
            joinTable: typeof c.joinTable === 'string' ? c.joinTable : undefined,
            evidence: c.evidence,
            source: c.source,
            disposition: (c.disposition === 'ask' ? 'ask' : 'autofill') as 'autofill' | 'ask',
            questions: c.disposition === 'ask' && Array.isArray(c.questions) ? c.questions : undefined,
          };
        });
    } catch {
      return [];
    }
  }

  private async requireProject(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true, name: true, structuredRequirement: true, planSummary: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);
    return project;
  }
}
