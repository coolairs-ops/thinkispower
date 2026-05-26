import { Injectable } from '@nestjs/common';

const STATUS_LABEL_MAP: Record<string, string> = {
  needs_input: '正在了解需求',
  clarifying: '正在帮你整理需求',
  prd_ready: '需求文档已确认',
  plan_ready: '方案已生成',
  awaiting_plan_confirmation: '等待你确认方案',
  demo_generating: '正在生成预览',
  demo_ready: '预览已准备好',
  awaiting_demo_feedback: '预览已准备好，可以开始批注',
  developing: '正在自动开发',
  testing: '正在检查功能是否正常',
  fixing: '正在根据反馈修改',
  exporting: '正在打包导出',
  build_pending: '构建队列中',
  build_failed: '构建失败',
  deploying: '正在上线',
  completed: '软件已准备好',
  paused: '项目已暂停',
  failed: '遇到问题，平台正在自动处理',
};

@Injectable()
export class StatusMapperService {
  mapProjectStatusToPublicLabel(status: string): string {
    return STATUS_LABEL_MAP[status] || '正在处理';
  }

  getAllStatusLabels(): Record<string, string> {
    return { ...STATUS_LABEL_MAP };
  }
}
