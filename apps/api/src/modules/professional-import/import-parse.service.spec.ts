import { NotFoundException } from '@nestjs/common';

jest.mock('mammoth', () => ({ extractRawText: jest.fn() }));
jest.mock('pdf-parse', () => jest.fn());

import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { ImportParseService } from './import-parse.service';

const mockMammoth = mammoth.extractRawText as jest.Mock;
const mockPdf = pdfParse as unknown as jest.Mock;

describe('ImportParseService', () => {
  let prisma: {
    assetFile: { findUnique: jest.Mock; update: jest.Mock };
  };
  let minio: { downloadFile: jest.Mock };
  let llm: { chat: jest.Mock };
  let service: ImportParseService;

  beforeEach(() => {
    prisma = {
      assetFile: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    minio = { downloadFile: jest.fn() };
    llm = { chat: jest.fn() };
    mockMammoth.mockReset();
    mockPdf.mockReset();
    service = new ImportParseService(prisma as never, minio as never, llm as never);
  });

  it('资产不存在 → NotFound', async () => {
    prisma.assetFile.findUnique.mockResolvedValue(null);
    await expect(service.parseAsset('x')).rejects.toThrow(NotFoundException);
  });

  it('文本类：下载字节 → 调 text-primary → 解析 JSON 笔记并落库', async () => {
    prisma.assetFile.findUnique.mockResolvedValue({
      id: 'a1', storageKey: 'imports/b/h/PRD.txt', mimeType: 'text/plain', fileName: 'PRD.txt',
    });
    minio.downloadFile.mockResolvedValue(Buffer.from('产品需求：登录、导出'));
    llm.chat.mockResolvedValue(
      '这是结果：{"summary":"一个PRD","features":["登录","导出"],"pages":[],"roles":["用户"],"entities":[],"notes":"无"}',
    );

    const r = await service.parseAsset('a1');

    expect(minio.downloadFile).toHaveBeenCalledWith('imports/b/h/PRD.txt');
    expect(llm.chat).toHaveBeenCalledWith('text-primary', expect.objectContaining({ user: expect.stringContaining('PRD.txt') }), expect.any(Object));
    expect(r.status).toBe('parsed');
    expect(r.mode).toBe('text');
    expect(r.summary).toBe('一个PRD');
    expect(r.features).toEqual(['登录', '导出']);
    expect(r.roles).toEqual(['用户']);
    expect(prisma.assetFile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1' }, data: expect.objectContaining({ parseSummary: r }) }),
    );
  });

  it('文本类：LLM 返回非法 JSON → raw 兜底', async () => {
    prisma.assetFile.findUnique.mockResolvedValue({
      id: 'a1', storageKey: 'k', mimeType: 'text/markdown', fileName: 'doc.md',
    });
    minio.downloadFile.mockResolvedValue(Buffer.from('# 标题'));
    llm.chat.mockResolvedValue('对不起我无法理解');

    const r = await service.parseAsset('a1');
    expect(r.status).toBe('parsed');
    expect(r.raw).toBe('对不起我无法理解');
    expect(r.summary).toBeUndefined();
  });

  it('图片类 → skipped(交由视觉模型)，不下载不调 LLM', async () => {
    prisma.assetFile.findUnique.mockResolvedValue({
      id: 'a1', storageKey: 'k', mimeType: 'image/png', fileName: 'screen.png',
    });
    const r = await service.parseAsset('a1');
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('视觉模型');
    expect(minio.downloadFile).not.toHaveBeenCalled();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('其余二进制(zip) → skipped(待专用解析器)', async () => {
    prisma.assetFile.findUnique.mockResolvedValue({
      id: 'a1', storageKey: 'k', mimeType: 'application/zip', fileName: 'proto.zip',
    });
    const r = await service.parseAsset('a1');
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('待专用解析器');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('Word(docx)：mammoth 抽取文本 → 调 LLM', async () => {
    prisma.assetFile.findUnique.mockResolvedValue({
      id: 'a1', storageKey: 'k',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: '需求.docx',
    });
    minio.downloadFile.mockResolvedValue(Buffer.from('binary-docx'));
    mockMammoth.mockResolvedValue({ value: '功能：登录、下单' });
    llm.chat.mockResolvedValue('{"summary":"x","features":["登录"]}');

    const r = await service.parseAsset('a1');

    expect(mockMammoth).toHaveBeenCalled();
    expect(llm.chat).toHaveBeenCalledWith('text-primary', expect.objectContaining({ user: expect.stringContaining('登录、下单') }), expect.any(Object));
    expect(r.status).toBe('parsed');
    expect(r.features).toEqual(['登录']);
  });

  it('PDF：pdf-parse 抽取文本 → 调 LLM', async () => {
    prisma.assetFile.findUnique.mockResolvedValue({
      id: 'a1', storageKey: 'k', mimeType: 'application/pdf', fileName: 'spec.pdf',
    });
    minio.downloadFile.mockResolvedValue(Buffer.from('binary-pdf'));
    mockPdf.mockResolvedValue({ text: '页面：首页、详情页' });
    llm.chat.mockResolvedValue('{"summary":"y","pages":["首页"]}');

    const r = await service.parseAsset('a1');

    expect(mockPdf).toHaveBeenCalled();
    expect(llm.chat).toHaveBeenCalledWith('text-primary', expect.objectContaining({ user: expect.stringContaining('首页、详情页') }), expect.any(Object));
    expect(r.status).toBe('parsed');
    expect(r.pages).toEqual(['首页']);
  });

  it('抽取到空文本(扫描件) → skipped，不调 LLM', async () => {
    prisma.assetFile.findUnique.mockResolvedValue({
      id: 'a1', storageKey: 'k', mimeType: 'application/pdf', fileName: 'scan.pdf',
    });
    minio.downloadFile.mockResolvedValue(Buffer.from('binary-pdf'));
    mockPdf.mockResolvedValue({ text: '   \n  ' });

    const r = await service.parseAsset('a1');
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('未从');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → status=error 并落库(不冒泡)', async () => {
    prisma.assetFile.findUnique.mockResolvedValue({
      id: 'a1', storageKey: 'k', mimeType: 'text/plain', fileName: 'a.txt',
    });
    minio.downloadFile.mockResolvedValue(Buffer.from('x'));
    llm.chat.mockRejectedValue(new Error('超时'));

    const r = await service.parseAsset('a1');
    expect(r.status).toBe('error');
    expect(r.reason).toBe('超时');
    expect(prisma.assetFile.update).toHaveBeenCalled();
  });
});
