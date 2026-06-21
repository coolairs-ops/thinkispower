import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { listTemplateMeta, findTemplate } from './rule-templates';

/**
 * 行业模板库端点（机制1）：配置态 UI 据此"选行业→加载模板"。
 * 模板是全局只读资源（非项目级）；内容是配置数据，加行业不改代码。
 */
@Controller('api/rule-templates')
@UseGuards(JwtAuthGuard)
export class RuleTemplateController {
  /** 模板列表（元数据，轻量） */
  @Get()
  list() {
    return { templates: listTemplateMeta() };
  }

  /** 单个模板全量（rulePack + 样例案例） */
  @Get(':id')
  get(@Param('id') id: string) {
    const t = findTemplate(id);
    if (!t) throw new NotFoundException('模板不存在');
    return t;
  }
}
