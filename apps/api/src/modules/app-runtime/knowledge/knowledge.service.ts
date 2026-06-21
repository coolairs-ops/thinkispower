import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RuleDataContext } from '../rule-engine/rule-pack.types';
import {
  Source, Evidence, Fact, KnowledgeBase, FactExtractor, SourceInput, TraceEntry,
} from './knowledge.types';

/**
 * 可溯源知识库服务（接入轨 Slice A）。
 *
 * 实现 knowledge.schema 的四步提取 + 缝合规则引擎：
 *   ingest：① AI 提取候选(强制附原文+位置) → ② 机器校验门(回原件核对 quote 真存在) → ④ 缺失显式
 *   confirm：③ 人工确认 candidate→confirmed（只有 confirmed 才可进评分）
 *   toRuleContext：confirmed Fact → RuleDataContext（fact 作关联实体，引擎按 name 过滤聚合，零引擎改动）
 *   trace：从 Fact 顺链回指 Evidence(原文) → Source(原件)，证明每个评分数据可溯源
 *
 * 确定性、零 LLM（提取器是注入接口；真实 LLM 提取器实现同接口插入，本服务不变）。
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  /**
   * 吸纳一份原件：提取候选 → 机器校验门 → 落 Evidence + Fact（candidate/rejected）+ 缺失显式。
   * @param needFactNames 评分需要的 Fact 名清单；未被提取到的标 status=missing（绝不静默补0）。
   */
  ingest(input: SourceInput, extractor: FactExtractor, needFactNames: string[] = []): KnowledgeBase {
    const source: Source = {
      source_id: 'SRC-1',
      title: input.title,
      doc_type: input.doc_type,
      issuer: input.issuer,
      doc_number: input.doc_number,
      issued_date: input.issued_date ?? null,
      uploaded_by: input.uploaded_by,
      content_hash: sha256(input.text), // 原件指纹
      status: 'active',
    };
    const norm = stripWs(input.text);

    const evidences: Evidence[] = [];
    const facts: Fact[] = [];
    const candidates = extractor(input.text); // 步骤1：AI 找候选（强制附 quote+locator）
    candidates.forEach((c, i) => {
      // 步骤2：机器校验门——回原件核对 quote 是否真存在（去空白容差），对不上作废
      const verified = !!c.quote && norm.includes(stripWs(c.quote));
      const ev: Evidence = {
        evidence_id: `EV-${i + 1}`,
        source_id: source.source_id,
        quote: c.quote,
        locator: c.locator,
        verified_in_source: verified,
      };
      evidences.push(ev);
      facts.push({
        fact_id: `FACT-${i + 1}`,
        name: c.name,
        value: c.value,
        evidence_refs: [ev.evidence_id],
        extraction_method: 'ai_extracted',
        status: verified ? 'candidate' : 'rejected', // 校验门过=candidate(待人工确认)；不过=rejected
      });
    });

    // 步骤4：缺失显式——评分需要但没提取到的，标 missing（绝不静默补0/给默认值）
    let mi = facts.length;
    for (const need of needFactNames) {
      if (!facts.some((f) => f.name === need && f.status !== 'rejected')) {
        facts.push({ fact_id: `FACT-${++mi}`, name: need, value: null, evidence_refs: [], extraction_method: 'ai_extracted', status: 'missing' });
      }
    }

    this.logger.log(`ingest「${input.title}」: ${candidates.length} 候选 → ${facts.filter((f) => f.status === 'candidate').length} 过校验门 / ${facts.filter((f) => f.status === 'rejected').length} 作废 / ${facts.filter((f) => f.status === 'missing').length} 缺失`);
    return { sources: [source], evidences, facts };
  }

  /** 步骤3：人工确认 candidate→confirmed（只有 confirmed 才可进评分）。 */
  confirm(kb: KnowledgeBase, factIds: string[], by: string, now: string): KnowledgeBase {
    const ids = new Set(factIds);
    return {
      ...kb,
      facts: kb.facts.map((f) =>
        ids.has(f.fact_id) && f.status === 'candidate'
          ? { ...f, status: 'confirmed' as const, confirmed_by: by, confirmed_at: now }
          : f,
      ),
    };
  }

  /**
   * 缝合规则引擎：confirmed Fact → RuleDataContext。
   * Facts 作 `fact` 关联实体（每行 {id,name,value,evidence}），metric 用 `source: 'fact.value'` +
   * `filter: "name = '<事实名>'"` + 聚合 取数——复用引擎现有聚合，零引擎改动。
   */
  toRuleContext(kb: KnowledgeBase): RuleDataContext {
    const rows = kb.facts
      .filter((f) => f.status === 'confirmed')
      .map((f) => ({ id: f.fact_id, name: f.name, value: f.value, evidence: f.evidence_refs[0] ?? '' }));
    return { subject: {}, related: { fact: rows } };
  }

  /** 证据链：从每个 confirmed Fact 顺链回指 Evidence(原文) → Source(原件)。证明评分数据可溯源到原件一句话。 */
  trace(kb: KnowledgeBase): TraceEntry[] {
    const evById = new Map(kb.evidences.map((e) => [e.evidence_id, e]));
    const srcById = new Map(kb.sources.map((s) => [s.source_id, s]));
    return kb.facts
      .filter((f) => f.status === 'confirmed')
      .map((f) => {
        const ev = evById.get(f.evidence_refs[0]);
        const src = ev ? srcById.get(ev.source_id) : undefined;
        return {
          factName: f.name, value: f.value, status: f.status,
          quote: ev?.quote, locator: ev?.locator,
          sourceTitle: src?.title, sourceStatus: src?.status, verified: ev?.verified_in_source,
        };
      });
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
/** 去空白容差：校验门核对 quote 时忽略空格/换行差异（扫描/排版抖动），但仍是真子串。 */
function stripWs(s: string): string {
  return s.replace(/\s+/g, '');
}
