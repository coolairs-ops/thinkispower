import { DeliveryMessageService } from './delivery-message.service';
import { SanitizeService } from '../services/sanitize.service';

describe('DeliveryMessageService', () => {
  const svc = new DeliveryMessageService(new SanitizeService());

  it('internalMessage 原样保留技术细节', () => {
    const raw = 'Cloudecode 执行 Agent 任务失败: tsc error';
    expect(svc.build(raw).internalMessage).toBe(raw);
  });

  it('publicMessage 脱敏掉内部禁用词', () => {
    const m = svc.build('Cloudecode 调度 Agent 处理工程控制论闭环');
    expect(m.publicMessage).not.toContain('Cloudecode');
    expect(m.publicMessage).not.toContain('Agent');
    expect(m.publicMessage).not.toContain('工程控制论');
  });

  it('显式 publicMessage 优先，但仍过脱敏兜底', () => {
    const m = svc.build('内部: Claude Code timeout', '后台处理中（Cloudecode 兜底）');
    expect(m.internalMessage).toContain('Claude Code');
    expect(m.publicMessage).not.toContain('Cloudecode');
  });

  it('无内部词的普通文案原样通过', () => {
    expect(svc.build('客户管理功能已完成').publicMessage).toBe('客户管理功能已完成');
  });
});
