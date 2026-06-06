import { NotFoundException } from '@nestjs/common';
import { ImportParseService } from './import-parse.service';

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

  it('二进制类(pdf) → skipped(待专用解析器)', async () => {
    prisma.assetFile.findUnique.mockResolvedValue({
      id: 'a1', storageKey: 'k', mimeType: 'application/pdf', fileName: 'spec.pdf',
    });
    const r = await service.parseAsset('a1');
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('待专用解析器');
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
