import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DeliveryOrchestrator } from './delivery-orchestrator.service';
import { PrismaService } from '../database/prisma.service';
import { BuildService } from './build.service';
import { StatusMapperService } from './status-mapper.service';
import { DeepseekService } from './deepseek.service';
import { CloudecodeClient } from '../integrations/cloudecode/cloudecode.client';
import { HermesClient } from '../integrations/hermes/hermes.client';
import { N8nClient } from '../integrations/n8n/n8n.client';
import { MinioService } from '../integrations/minio/minio.service';
import { EVENTS } from '../events/event-types';

jest.mock('../common/utils/zip', () => ({
  createZipBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-zip')),
}));

describe('DeliveryOrchestrator', () => {
  let orchestrator: DeliveryOrchestrator;

  const mockEventEmitter = { emit: jest.fn() };
  const mockPrismaService = {
    project: { findUnique: jest.fn(), update: jest.fn() },
  };
  const mockBuildService = {
    updateBuildStatus: jest.fn(),
    updateBuildArtifact: jest.fn(),
    uploadArtifact: jest.fn().mockResolvedValue('http://minio/artifact.zip'),
  };
  const mockStatusMapper = {
    mapProjectStatusToPublicLabel: jest.fn().mockReturnValue('some-label'),
  };
  const mockDeepseekService = { chat: jest.fn() };
  const mockCloudecode = {
    generateProject: jest.fn().mockResolvedValue([
      { path: 'index.html', content: '<html></html>' },
      { path: 'package.json', content: '{}' },
    ]),
    generateAsset: jest.fn().mockResolvedValue({
      content: '# Generated asset',
      fileName: 'asset.md',
      contentType: 'text/markdown; charset=utf-8',
    }),
  };
  const mockHermes = {};
  const mockN8n = {
    triggerDeliveryExportWorkflow: jest.fn().mockResolvedValue({ success: true, runId: 'run-1' }),
  };
  const mockMinio = {};

  const basePayload = {
    projectId: 'project-1',
    buildId: 'build-1',
    userId: 'user-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryOrchestrator,
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BuildService, useValue: mockBuildService },
        { provide: StatusMapperService, useValue: mockStatusMapper },
        { provide: DeepseekService, useValue: mockDeepseekService },
        { provide: CloudecodeClient, useValue: mockCloudecode },
        { provide: HermesClient, useValue: mockHermes },
        { provide: N8nClient, useValue: mockN8n },
        { provide: MinioService, useValue: mockMinio },
      ],
    }).compile();

    orchestrator = module.get<DeliveryOrchestrator>(DeliveryOrchestrator);

    mockPrismaService.project.findUnique.mockResolvedValue({
      name: 'test-project',
      demoHtml: '<html><body>Hello</body></html>',
      planSummary: { summary: 'Test' },
      structuredRequirement: null,
    });
  });

  it('should be defined', () => {
    expect(orchestrator).toBeDefined();
  });

  describe('handleExportRequest', () => {
    // ═══════ 同步导出类型 ═══════

    it('should handle source export and emit completed event', async () => {
      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'source' });

      expect(mockBuildService.updateBuildStatus).toHaveBeenCalledWith('build-1', 'building');
      expect(mockCloudecode.generateProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-project' }),
      );
      expect(mockBuildService.uploadArtifact).toHaveBeenCalled();
      expect(mockBuildService.updateBuildStatus).toHaveBeenCalledWith('build-1', 'success');
      expect(mockPrismaService.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'demo_ready' }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.DELIVERY_EXPORT_COMPLETED,
        expect.objectContaining({ exportType: 'source', buildId: 'build-1' }),
      );
    });

    it('should handle deployment export same as source', async () => {
      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'deployment' });

      expect(mockCloudecode.generateProject).toHaveBeenCalled();
      expect(mockBuildService.uploadArtifact).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.DELIVERY_EXPORT_COMPLETED,
        expect.objectContaining({ exportType: 'deployment' }),
      );
    });

    it('should handle package export via handlePackageExport', async () => {
      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'package' });

      expect(mockCloudecode.generateProject).toHaveBeenCalled();
      expect(mockBuildService.uploadArtifact).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), 'package',
        expect.anything(), expect.stringContaining('-package.zip'),
        'application/zip',
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.DELIVERY_EXPORT_COMPLETED,
        expect.objectContaining({ exportType: 'package' }),
      );
    });

    // ═══════ 异步导出类型 ═══════

    it('should trigger N8N workflow for repository export and return early', async () => {
      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'repository' });

      expect(mockN8n.triggerDeliveryExportWorkflow).toHaveBeenCalledWith('project-1', 'repository');
      expect(mockBuildService.updateBuildStatus).toHaveBeenCalledTimes(1); // only 'building'
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should trigger N8N workflow for database export and return early', async () => {
      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'database' });

      expect(mockN8n.triggerDeliveryExportWorkflow).toHaveBeenCalledWith('project-1', 'database');
      expect(mockBuildService.updateBuildStatus).toHaveBeenCalledTimes(1);
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    // ═══════ 错误处理 ═══════

    it('should throw and emit failed event for unknown export type', async () => {
      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'unknown' as any });

      expect(mockBuildService.updateBuildStatus).toHaveBeenCalledWith('build-1', 'failed');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.DELIVERY_EXPORT_FAILED,
        expect.objectContaining({ exportType: 'unknown', error: expect.stringContaining('Unknown export type') }),
      );
    });

    it('should fallback to local asset generation when N8N unavailable', async () => {
      mockN8n.triggerDeliveryExportWorkflow.mockResolvedValueOnce({ success: false, runId: undefined });

      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'repository' });

      expect(mockCloudecode.generateAsset).toHaveBeenCalledWith(
        'export_repository',
        expect.objectContaining({}),
      );
      expect(mockBuildService.uploadArtifact).toHaveBeenCalled();
      expect(mockBuildService.updateBuildArtifact).toHaveBeenCalledWith(
        'build-1', 'repository', 'http://minio/artifact.zip',
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.DELIVERY_EXPORT_COMPLETED,
        expect.objectContaining({ exportType: 'repository' }),
      );
    });

    it('should catch errors from cloudecode.generateProject and emit failed event', async () => {
      mockCloudecode.generateProject.mockRejectedValueOnce(new Error('API timeout'));

      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'source' });

      expect(mockBuildService.updateBuildStatus).toHaveBeenCalledWith('build-1', 'failed');
      expect(mockPrismaService.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'build_failed' }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.DELIVERY_EXPORT_FAILED,
        expect.objectContaining({ error: 'API timeout' }),
      );
    });

    // ═══════ 边界情况 ═══════

    it('should return undefined and not upload when demoHtml is null', async () => {
      mockPrismaService.project.findUnique.mockResolvedValueOnce({
        name: 'test-project',
        demoHtml: null,
        planSummary: null,
        structuredRequirement: null,
      });

      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'source' });

      expect(mockCloudecode.generateProject).not.toHaveBeenCalled();
      expect(mockBuildService.uploadArtifact).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.DELIVERY_EXPORT_COMPLETED,
        expect.objectContaining({ artifactUrl: undefined }),
      );
    });

    it('should update build artifact URL when present', async () => {
      await orchestrator.handleExportRequest({ ...basePayload, exportType: 'source' });

      expect(mockBuildService.updateBuildArtifact).toHaveBeenCalledWith(
        'build-1', 'source', 'http://minio/artifact.zip',
      );
    });
  });
});
