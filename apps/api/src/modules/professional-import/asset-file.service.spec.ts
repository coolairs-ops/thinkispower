import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AssetFileService, UploadedAsset } from './asset-file.service';

describe('AssetFileService', () => {
  let prisma: {
    importBatch: { findUnique: jest.Mock };
    assetFile: { findFirst: jest.Mock; create: jest.Mock };
  };
  let minio: { uploadFile: jest.Mock };
  let queue: { add: jest.Mock };
  let service: AssetFileService;
  const ctx = { userId: 'u1', orgId: 'org-1' };

  const file = (overrides: Partial<UploadedAsset> = {}): UploadedAsset => ({
    originalname: 'PRD.pdf',
    mimetype: 'application/pdf',
    size: 1234,
    buffer: Buffer.from('hello-prd'),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      importBatch: { findUnique: jest.fn() },
      assetFile: { findFirst: jest.fn(), create: jest.fn() },
    };
    minio = { uploadFile: jest.fn().mockResolvedValue('http://signed') };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new AssetFileService(prisma as never, minio as never, queue as never);
  });

  it('无文件 → BadRequest', async () => {
    await expect(service.addFile(ctx, 'b1', undefined)).rejects.toThrow(BadRequestException);
  });

  it('批次不存在 → NotFound', async () => {
    prisma.importBatch.findUnique.mockResolvedValue(null);
    await expect(service.addFile(ctx, 'b1', file())).rejects.toThrow(NotFoundException);
  });

  it('跨租户批次 → Forbidden', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-2' });
    await expect(service.addFile(ctx, 'b1', file())).rejects.toThrow(ForbiddenException);
  });

  it('正常上传：算 sha256、传 MinIO、按扩展名分类、写 AssetFile', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1' });
    prisma.assetFile.findFirst.mockResolvedValue(null);
    prisma.assetFile.create.mockImplementation(({ data }: never) => ({ id: 'a1', ...(data as object) }));

    const f = file();
    const expectedSum = createHash('sha256').update(f.buffer).digest('hex');
    await service.addFile(ctx, 'b1', f);

    expect(minio.uploadFile).toHaveBeenCalledWith(
      `imports/b1/${expectedSum}/PRD.pdf`,
      f.buffer,
      { contentType: 'application/pdf' },
    );
    expect(prisma.assetFile.create).toHaveBeenCalledWith({
      data: {
        batchId: 'b1',
        category: 'document',
        fileName: 'PRD.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(1234),
        storageKey: `imports/b1/${expectedSum}/PRD.pdf`,
        checksum: expectedSum,
      },
    });
    expect(queue.add).toHaveBeenCalledWith('parse', { assetId: 'a1' });
  });

  it('秒传：同批次同 checksum 直接复用，不重复上传', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1' });
    const existing = { id: 'a0', checksum: 'dup' };
    prisma.assetFile.findFirst.mockResolvedValue(existing);

    const result = await service.addFile(ctx, 'b1', file());

    expect(result).toBe(existing);
    expect(minio.uploadFile).not.toHaveBeenCalled();
    expect(prisma.assetFile.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('显式 category 覆盖扩展名推断', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1' });
    prisma.assetFile.findFirst.mockResolvedValue(null);
    prisma.assetFile.create.mockImplementation(({ data }: never) => data);

    await service.addFile(ctx, 'b1', file({ originalname: 'home.rp' }), 'design');
    expect(prisma.assetFile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: 'design' }) }),
    );
  });

  it('未知扩展名 → other', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1' });
    prisma.assetFile.findFirst.mockResolvedValue(null);
    prisma.assetFile.create.mockImplementation(({ data }: never) => data);

    await service.addFile(ctx, 'b1', file({ originalname: 'weird.xyz' }));
    expect(prisma.assetFile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: 'other' }) }),
    );
  });
});
