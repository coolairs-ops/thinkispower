import { Controller, Post, Param, UseGuards, Req, Body } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DiscoveryEngineService } from './discovery-engine.service';
import { PrismaService } from '../../database/prisma.service';
import { DiscoveryNextDto, DiscoveryEnrichDto } from './dto/discovery.dto';

@Controller('api/projects/:projectId/discovery')
@UseGuards(JwtAuthGuard)
export class DiscoveryController {
  constructor(
    private readonly discoveryEngine: DiscoveryEngineService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('next')
  async getNextQuestion(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() body: DiscoveryNextDto,
  ) {
    const answer = body?.answer;
    console.log('[discovery] got answer:', answer ? 'yes' : 'no', 'projectId:', projectId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, description: true, structuredRequirement: true },
    });
    if (!project) return { error: '项目不存在' };

    // 如果用户提供了回答，保存为消息并尝试更新结构化需求
    if (answer) {
      await this.prisma.projectMessage.create({
        data: { projectId, role: 'user', content: answer },
      });

      await this.enrichFromAnswer(projectId, answer, project.structuredRequirement);

      const updated = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, description: true, structuredRequirement: true },
      });
      project.name = updated?.name || project.name;
      project.description = updated?.description || project.description;
      project.structuredRequirement = updated?.structuredRequirement || project.structuredRequirement;
    }

    // 获取已有消息
    const messages = await this.prisma.projectMessage.findMany({
      where: { projectId, role: 'user' },
      orderBy: { createdAt: 'asc' },
      select: { content: true },
    });

    return this.discoveryEngine.discover(
      project.name,
      project.description || '',
      project.structuredRequirement,
      messages.map(m => m.content),
    );
  }

  @Post('enrich')
  async enrichProject(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() body: DiscoveryEnrichDto,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { structuredRequirement: true },
    });
    if (!project) return { error: '项目不存在' };

    const sr = (project.structuredRequirement as any) || {};
    const prd = sr.prd || {};

    // 映射字段名到 prd 结构
    const fieldMap: Record<string, string> = {
      productForm: 'productForm',
      targetUsers: 'targetUsers',
      features: 'features',
      pages: 'pages',
      dataObjects: 'dataObjects',
      businessRules: 'businessRules',
      scale: 'estimatedUsers',
      acceptanceCriteria: 'acceptanceChecklist',
    };

    const prdField = fieldMap[body.field] || body.field;
    prd[prdField] = body.value;

    await this.prisma.project.update({
      where: { id: projectId },
      data: { structuredRequirement: { ...sr, prd } as any },
    });

    // 也保存为消息
    const displayValue = Array.isArray(body.value)
      ? body.value.join('、')
      : String(body.value || '');
    await this.prisma.projectMessage.create({
      data: {
        projectId,
        role: 'user',
        content: displayValue,
      },
    });

    return { success: true };
  }

  /** 从用户回答中提取关键信息更新 prd */
  private async enrichFromAnswer(projectId: string, answer: string, sr: any) {
    const prd = (sr?.prd || {}) as Record<string, any>;
    let changed = false;

    // 检测产品形态关键词
    if (!prd.productForm) {
      if (/网页|web|浏览器/.test(answer)) { prd.productForm = '网页'; changed = true; }
      else if (/app|手机|移动端|ios|android/i.test(answer)) { prd.productForm = '手机App'; changed = true; }
      else if (/小程序/.test(answer)) { prd.productForm = '微信小程序'; changed = true; }
    }

    // 检测目标用户
    if (!prd.targetUsers) {
      if (/我自己|个人|我一个人/.test(answer)) { prd.targetUsers = '个人使用'; changed = true; }
      else if (/团队|公司|部门|同事/.test(answer)) { prd.targetUsers = '团队使用'; changed = true; }
    }

    // 检测功能关键词
    const featureKw: Record<string, string> = {
      '拍照': '拍照识别', '识别': '智能识别', '统计': '分类统计',
      '预算': '预算管理', '提醒': '提醒通知', '报表': '数据报表',
      '导出': '数据导出', '搜索': '搜索查询', '分享': '分享功能',
      '登录': '用户登录', '权限': '权限管理', '通知': '消息通知',
      '标签': '标签分类', '筛选': '条件筛选', '排序': '排序功能',
    };
    const features = prd.features || [];
    for (const [kw, feat] of Object.entries(featureKw)) {
      if (answer.includes(kw) && !features.includes(feat)) {
        features.push(feat);
      }
    }
    if (features.length > (prd.features?.length || 0)) {
      prd.features = features;
      changed = true;
    }

    // 检测数据对象
    const dataKw: Record<string, string> = {
      '交易记录': '交易记录', '账单': '账单', '发票': '发票',
      '用户': '用户', '客户': '客户', '订单': '订单',
      '分类': '分类', '标签': '标签', '预算': '预算',
    };
    const dataObjects = prd.dataObjects || [];
    for (const [kw, obj] of Object.entries(dataKw)) {
      if (answer.includes(kw) && !dataObjects.includes(obj)) {
        dataObjects.push(obj);
      }
    }
    if (dataObjects.length > (prd.dataObjects?.length || 0)) {
      prd.dataObjects = dataObjects;
      changed = true;
    }

    // 检测业务规则
    const rules = prd.businessRules || [];
    if (/超过|超出|阈值|限额/.test(answer) && !rules.includes('超额提醒')) {
      rules.push('超额提醒'); changed = true;
    }
    if (/自动|智能/.test(answer) && !rules.includes('自动处理')) {
      rules.push('自动处理'); changed = true;
    }
    if (rules.length > (prd.businessRules?.length || 0)) {
      prd.businessRules = rules;
      changed = true;
    }

    if (changed) {
      console.log('[enrich] updating prd:', JSON.stringify(prd).slice(0, 200));
      await this.prisma.project.update({
        where: { id: projectId },
        data: { structuredRequirement: { ...sr, prd } as any },
      });
    } else {
      console.log('[enrich] no changes detected');
    }
  }
}
