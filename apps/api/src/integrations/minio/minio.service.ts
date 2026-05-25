import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Minio.Client;
  private bucket: string;
  private publicUrl: string;

  constructor(private config: ConfigService) {
    this.client = new Minio.Client({
      endPoint: this.config.get('MINIO_ENDPOINT', 'localhost:9000').split(':')[0],
      port: parseInt(this.config.get('MINIO_ENDPOINT', 'localhost:9000').split(':')[1] || '9000', 10),
      useSSL: this.config.get('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.config.get('MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: this.config.get('MINIO_SECRET_KEY', 'minioadmin_secret'),
    });
    this.bucket = this.config.get('MINIO_BUCKET', 'platform-assets');
    this.publicUrl = this.config.get('MINIO_PUBLIC_URL', 'http://localhost:9000');
  }

  async onModuleInit() {
    await this.ensureBucket();
  }

  private async ensureBucket(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Bucket "${this.bucket}" created`);
      } else {
        this.logger.log(`Bucket "${this.bucket}" already exists`);
      }
    } catch (error) {
      this.logger.warn(`Cannot access MinIO (bucket may be created later): ${error}`);
    }
  }

  /**
   * Upload a buffer to MinIO and return a presigned URL for download.
   */
  async uploadFile(
    objectName: string,
    buffer: Buffer,
    metaData?: Record<string, string>,
  ): Promise<string> {
    await this.client.putObject(this.bucket, objectName, buffer, buffer.length, {
      'Content-Type': metaData?.contentType || 'application/octet-stream',
      ...metaData,
    });

    // Return presigned URL (valid for 24 hours by default)
    const url = await this.client.presignedGetObject(this.bucket, objectName, 24 * 60 * 60);
    this.logger.log(`File uploaded: ${objectName}`);

    // Also return public URL as fallback
    return url;
  }

  /**
   * Generate a public URL for a given object name.
   */
  getPublicUrl(objectName: string): string {
    return `${this.publicUrl}/${this.bucket}/${objectName}`;
  }

  /**
   * Delete an object from the bucket.
   */
  async deleteFile(objectName: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectName);
    this.logger.log(`File deleted: ${objectName}`);
  }

  /**
   * Check if an object exists.
   */
  async fileExists(objectName: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, objectName);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a presigned URL for temporary access.
   */
  async getPresignedUrl(objectName: string, expirySeconds = 86400): Promise<string> {
    return this.client.presignedGetObject(this.bucket, objectName, expirySeconds);
  }

  /**
   * Build a namespaced object name for a project artifact.
   */
  buildObjectName(projectId: string, exportType: string, filename: string): string {
    return `projects/${projectId}/${exportType}/${filename}`;
  }
}
