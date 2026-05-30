import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { N8nClient } from './n8n.client';

describe('N8nClient', () => {
  let client: N8nClient;
  let originalFetch: typeof global.fetch;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'N8N_URL') return 'http://localhost:5678';
      if (key === 'N8N_API_KEY') return '';
      return defaultValue;
    }),
  };

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        N8nClient,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    client = module.get<N8nClient>(N8nClient);
  });

  describe('triggerWorkflow', () => {
    it('should POST to N8N webhook and return success with runId', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ runId: 'abc-123' }),
      });

      const result = await client.triggerWorkflow('my-workflow', { projectId: 'p1' });

      expect(result).toEqual({ success: true, runId: 'abc-123' });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5678/webhook/my-workflow',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('projectId'),
        }),
      );
    });

    it('should return success with requestId when response has no runId', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      const result = await client.triggerWorkflow('test', {});

      expect(result.success).toBe(true);
      expect(result.runId).toBeDefined();
    });

    it('should return failure on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await client.triggerWorkflow('missing', {});

      expect(result).toEqual({ success: false });
    });

    it('should return failure on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await client.triggerWorkflow('failing', {});

      expect(result).toEqual({ success: false });
    });

    it('should include API key header when configured', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          N8nClient,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                if (key === 'N8N_URL') return 'http://n8n:5678';
                if (key === 'N8N_API_KEY') return 'sk-secret';
                return defaultValue;
              }),
            },
          },
        ],
      }).compile();

      const clientWithKey = module.get<N8nClient>(N8nClient);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      await clientWithKey.triggerWorkflow('secured', {});

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-API-Key': 'sk-secret' }),
        }),
      );
    });
  });

  describe('wrapper methods', () => {
    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });
    });

    it('triggerTaskPlanningWorkflow should call triggerWorkflow with correct name', async () => {
      const result = await client.triggerTaskPlanningWorkflow('p1', 'fb-1', ['t1', 't2']);

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5678/webhook/task-planning',
        expect.objectContaining({
          body: expect.stringContaining('p1'),
        }),
      );
    });

    it('triggerDemoGenerateWorkflow should call triggerWorkflow with correct name', async () => {
      await client.triggerDemoGenerateWorkflow('p1');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5678/webhook/demo-generate',
        expect.any(Object),
      );
    });

    it('triggerDeliveryExportWorkflow should call triggerWorkflow with correct name', async () => {
      await client.triggerDeliveryExportWorkflow('p1', 'full');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5678/webhook/delivery-export',
        expect.objectContaining({
          body: expect.stringContaining('full'),
        }),
      );
    });
  });
});
