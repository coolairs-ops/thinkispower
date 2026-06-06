import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { MinioService } from '../../integrations/minio/minio.service';
import { assertOrgAccess, TenantContext } from '../../common/utils/tenant-scope';
import { IMPORT_PARSE_QUEUE, ImportParseJob } from './import-parse.processor';

/** 上传文件的最小形状（multer memory storage） */
export interface UploadedAsset {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

const CATEGORY_BY_EXT: Record<string, string> = {
  // 文档
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  csv: 'document', md: 'document', txt: 'document', ppt: 'document', pptx: 'document',
  // 原型（Axure 三件套：.rp 工程文件 + HTML 导出包）
  rp: 'prototype', html: 'prototype', htm: 'prototype', zip: 'prototype',
  // 设计稿 / 截图
  png: 'design', jpg: 'design', jpeg: 'design', gif: 'design', webp: 'design',
  svg: 'design', sketch: 'design', fig: 'design',
};

/**
 * 文件接收（P15-2 第 2 步）：AssetFile + MinIO 上传 + checksum。
 *
 * - 字节落域内对象存储（MinIO），DB 只存引用 + checksum + 元信息（§1.1 数据不出域）。
 * - checksum 秒传：同批次内相同 checksum 直接复用记录（幂等、且不跨租户复用 storageKey，避免越权读字节）。
 */
@Injectable()
export class AssetFileService {
  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
    @InjectQueue(IMPORT_PARSE_QUEUE) private parseQueue: Queue<ImportParseJob>,
  ) {}

  /** 接收一份上传文件，落对象存储并登记 AssetFile */
  async addFile(
    ctx: TenantContext,
    batchId: string,
    file: UploadedAsset | undefined,
    category?: string,
  ) {
    if (!file) throw new BadRequestException('缺少上传文件');

    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('导入批次不存在');
    assertOrgAccess(batch.orgId, ctx.orgId, { allowLegacyNull: true });

    // multer/busboy 默认以 latin1 解析 multipart 文件名，中文会乱码 → 还原为 utf8
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    // 秒传：同批次同 checksum 直接复用（幂等重传），不重复上传字节
    const existing = await this.prisma.assetFile.findFirst({
      where: { batchId, checksum },
    });
    if (existing) return existing;

    const resolvedCategory = category ?? this.inferCategory(fileName);
    const storageKey = `imports/${batchId}/${checksum}/${fileName}`;

    await this.minio.uploadFile(storageKey, file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
    });

    const created = await this.prisma.assetFile.create({
      data: {
        batchId,
        category: resolvedCategory as never,
        fileName,
        mimeType: file.mimetype ?? null,
        sizeBytes: BigInt(file.size),
        storageKey,
        checksum,
      },
    });

    // 异步逐份理解（BullMQ）：不阻塞上传响应，进程重启不丢
    await this.parseQueue.add('parse', { assetId: created.id });

    return created;
  }

  /** 按扩展名粗分类；UI 已知槽位时由客户端显式传 category 覆盖 */
  private inferCategory(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    return CATEGORY_BY_EXT[ext] ?? 'other';
  }
}
