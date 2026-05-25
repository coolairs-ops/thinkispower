import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MinioService } from './minio.service';

describe('MinioService', () => {
  let service: MinioService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, string> = {
        MINIO_ENDPOINT: 'localhost:9000',
        MINIO_ACCESS_KEY: 'test-access',
        MINIO_SECRET_KEY: 'test-secret',
        MINIO_BUCKET: 'test-bucket',
        MINIO_PUBLIC_URL: 'http://localhost:9000',
        MINIO_USE_SSL: 'false',
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MinioService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MinioService>(MinioService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildObjectName', () => {
    it('should build namespaced object name', () => {
      const name = service.buildObjectName('project-1', 'source', 'source.zip');
      expect(name).toBe('projects/project-1/source/source.zip');
    });

    it('should handle different export types', () => {
      const name = service.buildObjectName('project-1', 'database', 'schema.sql');
      expect(name).toBe('projects/project-1/database/schema.sql');
    });

    it('should handle nested paths in filename', () => {
      const name = service.buildObjectName('p1', 'package', 'dist/app.zip');
      expect(name).toBe('projects/p1/package/dist/app.zip');
    });
  });

  describe('getPublicUrl', () => {
    it('should generate correct public URL', () => {
      const url = service.getPublicUrl('projects/p1/source/code.zip');
      expect(url).toBe('http://localhost:9000/test-bucket/projects/p1/source/code.zip');
    });
  });
});
