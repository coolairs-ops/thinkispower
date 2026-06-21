import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../../../database/prisma.service';
import { MinioService } from '../../../integrations/minio/minio.service';
import { KnowledgeService } from './knowledge.service';
import { LlmFactExtractor } from './llm-fact-extractor';
import { KnowledgeBase, Fact, FactExtractor, TraceEntry } from './knowledge.types';

export interface UploadedDoc {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}

const EMPTY_KB: KnowledgeBase = { sources: [], evidences: [], facts: [] };

/**
 * 文档上传链路（接入轨 ②）：上传原件 → 落 MinIO → 抽文本 → LLM 提取候选 → 机器校验门 →
 * 持久化知识库 → 供前端人工确认。知识库存 structuredRequirement.knowledgeBase（零迁移）。
 */
@Injectable()
export class KnowledgeSourceService {
  private readonly logger = new Logger(KnowledgeSourceService.name);

  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
    private knowledge: KnowledgeService,
    private llm: LlmFactExtractor,
  ) {}

  /** 上传一份原件：落 MinIO + 抽文本 + 提取候选 + 校验门 → 合并进持久化知识库。extractor 可注入（测试用桩）。 */
  async uploadSource(projectId: string, file: UploadedDoc, needFactNames: string[] = [], extractor?: FactExtractor): Promise<{ sourceId: string; candidates: Fact[] }> {
    const kind = this.classify(file.mimetype, file.originalname);
    if (kind === 'skip') throw new BadRequestException('暂不支持的文件类型（支持 docx/pdf/txt）');
    const text = (await this.extractText(kind, file.buffer)).trim();
    if (!text) throw new BadRequestException('未能从文件抽出文本');

    // 原件落 MinIO（只读留存，Source.storage_ref 指向它）
    const storageKey = `knowledge/${projectId}/${stamp(file.originalname)}`;
    await this.minio.uploadFile(storageKey, file.buffer, { contentType: file.mimetype || 'application/octet-stream' });

    // 步骤1：AI 提取候选（注入桩优先；否则真实 LLM）
    const candidates = extractor ? extractor(text) : await this.llm.extract(text);

    const current = await this.loadKB(projectId);
    const seq = current.sources.length + 1;
    // ingest 内含 步骤2 校验门 + 步骤4 缺失显式；用 seq namespacing 防多次上传 id 撞
    const delta = this.knowledge.ingest({ title: file.originalname, text, doc_type: kind, storage_ref: storageKey }, () => candidates, needFactNames, seq);

    const merged: KnowledgeBase = {
      sources: [...current.sources, ...delta.sources],
      evidences: [...current.evidences, ...delta.evidences],
      facts: [...current.facts, ...delta.facts],
    };
    await this.saveKB(projectId, merged);
    this.logger.log(`上传「${file.originalname}」→ ${delta.facts.filter((f) => f.status === 'candidate').length} 候选待确认 / ${delta.facts.filter((f) => f.status === 'rejected').length} 校验门作废`);
    return { sourceId: delta.sources[0].source_id, candidates: delta.facts };
  }

  async loadKB(projectId: string): Promise<KnowledgeBase> {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { structuredRequirement: true } });
    const sr = (p?.structuredRequirement ?? {}) as Record<string, unknown>;
    const kb = sr.knowledgeBase as KnowledgeBase | undefined;
    return kb && Array.isArray(kb.facts) ? kb : EMPTY_KB;
  }

  /** 含证据链：每个 confirmed Fact 顺链回指 Evidence→Source。 */
  async loadWithTrace(projectId: string): Promise<KnowledgeBase & { trace: TraceEntry[] }> {
    const kb = await this.loadKB(projectId);
    return { ...kb, trace: this.knowledge.trace(kb) };
  }

  /** 步骤3：人工确认 candidate→confirmed。 */
  async confirmFacts(projectId: string, factIds: string[], by: string, now: string): Promise<KnowledgeBase> {
    const kb = this.knowledge.confirm(await this.loadKB(projectId), factIds, by, now);
    await this.saveKB(projectId, kb);
    return kb;
  }

  /** 人工否决 candidate→rejected。 */
  async rejectFacts(projectId: string, factIds: string[]): Promise<KnowledgeBase> {
    const ids = new Set(factIds);
    const kb = await this.loadKB(projectId);
    const next = { ...kb, facts: kb.facts.map((f) => (ids.has(f.fact_id) && f.status === 'candidate' ? { ...f, status: 'rejected' as const } : f)) };
    await this.saveKB(projectId, next);
    return next;
  }

  private async saveKB(projectId: string, kb: KnowledgeBase): Promise<void> {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { structuredRequirement: true } });
    const sr = (p?.structuredRequirement ?? {}) as Record<string, unknown>;
    await this.prisma.project.update({ where: { id: projectId }, data: { structuredRequirement: { ...sr, knowledgeBase: kb } as never } });
  }

  private classify(mime: string | undefined, fileName: string): 'word' | 'pdf' | 'text' | 'skip' {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const m = mime ?? '';
    if (m.includes('pdf') || ext === 'pdf') return 'pdf';
    if (m.includes('wordprocessingml') || ext === 'docx') return 'word';
    if (m.startsWith('text/') || ['txt', 'md', 'csv'].includes(ext)) return 'text';
    return 'skip';
  }

  private async extractText(kind: 'word' | 'pdf' | 'text', buffer: Buffer): Promise<string> {
    if (kind === 'word') return (await mammoth.extractRawText({ buffer })).value;
    if (kind === 'pdf') return (await pdfParse(buffer)).text;
    return buffer.toString('utf8');
  }
}

function stamp(name: string): string {
  const safe = name.replace(/[^\w.\-一-龥]/g, '_').slice(-80);
  // 不用 Date.now()（沙箱限制）；用内容无关的随机串由调用频次区分即可，这里用高精度 hrtime
  return `${process.hrtime.bigint().toString(36)}-${safe}`;
}
