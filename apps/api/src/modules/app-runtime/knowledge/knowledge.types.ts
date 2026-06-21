/**
 * 可溯源知识库类型（镜像 knowledge.schema.json v1.0）。
 *
 * 三层溯源链：Source(原件) → Evidence(证据片段) → Fact(结构化值)。
 * 为规则引擎提供"每个评分数据都可溯源到真实材料"的底座——把 evidence_policy 从结论级下沉到数据级。
 * 配合四步提取（AI候选+机器验真+人确认+缺失显式），AI 在链中无一处能单独把数字送进结果。
 */

export type SourceStatus = 'active' | 'superseded' | 'revoked';

/** 第一层 原件：只读、留哈希、永不物理删除（只标失效）。 */
export interface Source {
  source_id: string; // SRC-*
  title: string;
  doc_type?: string;
  issuer?: string;
  doc_number?: string;
  issued_date?: string | null;
  uploaded_by?: string;
  content_hash: string; // 原件指纹，守护据此验未篡改
  storage_ref?: string;
  status: SourceStatus;
}

export interface EvidenceLocator {
  page?: number;
  paragraph?: number;
  bbox?: string; // 扫描件坐标框
  char_range?: string; // 文本字符区间
}

/** 第二层 证据片段：原件中"被用到的某一处"。rulepack 的 evidence_ref 指向它。 */
export interface Evidence {
  evidence_id: string; // EV-*
  source_id: string;
  quote: string; // 原文片段
  locator?: EvidenceLocator;
  summary?: string;
  /** 校验门结果：quote 是否经机器回原件核对、确实存在。false 者不得被 Fact 采纳 */
  verified_in_source: boolean;
}

export type FactStatus = 'candidate' | 'confirmed' | 'rejected' | 'missing';
export type ExtractionMethod = 'ai_extracted' | 'manual_entered';

/** 第三层 结构化值：进评分的值。每个挂≥1 evidence；只有 confirmed 才能被 metric 取数。 */
export interface Fact {
  fact_id: string; // FACT-*
  name: string; // 对应 metric 要用的字段名
  value: number | string | boolean | null;
  evidence_refs: string[]; // 支撑证据（≥1）；missing 时空
  extraction_method: ExtractionMethod;
  status: FactStatus;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
}

/** 知识库快照（ingest 产物 / 守护体检对象）。 */
export interface KnowledgeBase {
  sources: Source[];
  evidences: Evidence[];
  facts: Fact[];
}

/**
 * 提取器：AI 找候选，**强制附原文 quote + 位置 locator**（给不出出处的候选不存在）。
 * Slice A 用确定性实现证通链路；真实 LLM 提取器实现同一接口即可插入，链路其余部分不变。
 */
export interface FactCandidate {
  name: string;
  value: number | string | boolean | null;
  quote: string;
  locator?: EvidenceLocator;
}
export type FactExtractor = (sourceText: string) => FactCandidate[];

/** ingest 入参：一份原件。 */
export interface SourceInput {
  title: string;
  text: string;
  doc_type?: string;
  issuer?: string;
  doc_number?: string;
  issued_date?: string | null;
  uploaded_by?: string;
  storage_ref?: string; // 原件在 MinIO 的存储 key
}

/** 证据链条目：从 Fact 顺链回指 Evidence(原文) → Source(原件)。 */
export interface TraceEntry {
  factName: string;
  value: number | string | boolean | null;
  status: FactStatus;
  quote?: string;
  locator?: EvidenceLocator;
  sourceTitle?: string;
  sourceStatus?: SourceStatus;
  verified?: boolean;
}
