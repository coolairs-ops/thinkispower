import { StatusMapperService } from './status-mapper.service';

describe('StatusMapperService', () => {
  let service: StatusMapperService;

  beforeEach(() => {
    service = new StatusMapperService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('mapProjectStatusToPublicLabel', () => {
    const expectedMappings: [string, string][] = [
      ['needs_input', '正在了解需求'],
      ['clarifying', '正在帮你整理需求'],
      ['plan_ready', '方案已生成'],
      ['awaiting_plan_confirmation', '等待你确认方案'],
      ['demo_generating', '正在生成预览'],
      ['demo_ready', '预览已准备好'],
      ['awaiting_demo_feedback', '预览已准备好，可以开始批注'],
      ['developing', '正在自动开发'],
      ['testing', '正在检查功能是否正常'],
      ['fixing', '正在根据反馈修改'],
      ['exporting', '正在打包导出'],
      ['build_pending', '构建队列中'],
      ['build_failed', '构建失败'],
      ['deploying', '正在上线'],
      ['completed', '软件已准备好'],
      ['paused', '项目已暂停'],
      ['failed', '遇到问题，平台正在自动处理'],
    ];

    it.each(expectedMappings)('should map %s to "%s"', (status, label) => {
      expect(service.mapProjectStatusToPublicLabel(status)).toBe(label);
    });

    it('should return fallback for unknown status', () => {
      expect(service.mapProjectStatusToPublicLabel('unknown_status')).toBe('正在处理');
    });

    it('should handle empty string', () => {
      expect(service.mapProjectStatusToPublicLabel('')).toBe('正在处理');
    });
  });

  describe('getAllStatusLabels', () => {
    it('should return all status labels', () => {
      const all = service.getAllStatusLabels();
      expect(Object.keys(all)).toHaveLength(17);
      expect(all['needs_input']).toBe('正在了解需求');
      expect(all['completed']).toBe('软件已准备好');
    });

    it('should return a copy, not the original reference', () => {
      const all = service.getAllStatusLabels();
      all['test'] = 'test';
      const all2 = service.getAllStatusLabels();
      expect(all2['test']).toBeUndefined();
    });
  });
});
