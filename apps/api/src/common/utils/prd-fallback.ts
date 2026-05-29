export interface PRD {
  productName: string;
  summary: string;
  background: string;
  targetUsers: string[];
  userPainPoints: string[];
  useScenarios: string[];
  coreValue: string;
  productForm: string;
  mvpScope: string[];
  successCriteria: string[];
  pages: string[];
  features: string[];
  roles: string[];
  dataObjects: string[];
  riskPoints: string[];
}

export function getFallbackQuestion(userMessageCount: number): string | null {
  const questions = [
    '这个产品主要给谁用的？他们目前遇到了什么问题？',
    '你希望用户可以用它来做什么？能描述一下核心使用场景吗？',
    '做成网页版还是手机应用？第一版你最想实现哪几个功能？',
  ];
  return questions[userMessageCount - 1] || null;
}

export function generateFallbackPrd(text: string): PRD {
  const isCrm = /客户|crm|销售|客/i.test(text);
  const isEcom = /商城|电商|购物|订单|商品/i.test(text);
  const isOa = /办公|oa|审批|流程|考勤/i.test(text);
  const isTask = /任务|项目|协作|团队|看板/i.test(text);
  const isEdu = /教育|课程|学习|培训|学生/i.test(text);
  const isContent = /博客|文章|资讯|新闻|内容/i.test(text);
  const isReserve = /预约|排号|预定|挂号/i.test(text);
  const isDelivery = /外卖|点餐|菜单|餐厅|餐饮/i.test(text);
  const isInventory = /库存|进销存|仓库|入库|出库/i.test(text);

  let summary = '业务管理系统';
  let targetUsers = ['企业员工', '管理员'];
  let pages = ['首页', '登录页', '数据列表页', '详情页'];
  let features = ['基础数据管理'];
  let roles = ['管理员', '普通用户'];
  let dataObjects = ['用户', '业务数据'];

  // Order matters: more specific patterns first, task is last since "团队"/"项目" are very generic
  if (isInventory) {
    summary = '进销存管理系统';
    targetUsers = ['仓库管理员', '采购员', '管理员'];
    pages = ['库存看板', '入库管理', '出库管理', '商品管理', '报表统计'];
    features = ['商品管理', '入库管理', '出库管理', '库存预警', '销售统计'];
    roles = ['管理员', '仓库管理员'];
    dataObjects = ['商品', '入库单', '出库单', '库存记录'];
  } else if (isDelivery) {
    summary = '外卖点餐系统';
    targetUsers = ['顾客', '商家', '管理员'];
    pages = ['首页', '菜单页', '下单页', '订单追踪页', '商家后台'];
    features = ['菜单浏览', '在线点餐', '订单追踪', '评价系统'];
    roles = ['管理员', '商家', '顾客'];
    dataObjects = ['菜单', '订单', '用户', '商家'];
  } else if (isReserve) {
    summary = '预约管理系统';
    targetUsers = ['普通用户', '管理员'];
    pages = ['首页', '预约页', '预约记录页', '管理后台'];
    features = ['在线预约', '排号管理', '预约提醒', '数据统计'];
    roles = ['管理员', '普通用户'];
    dataObjects = ['用户', '预约单', '服务项目'];
  } else if (isCrm) {
    summary = '客户管理系统';
    targetUsers = ['销售员', '销售经理', '管理员'];
    pages = ['首页', '客户列表', '客户详情', '跟进记录', '统计看板'];
    features = ['客户信息管理', '跟进记录', '销售漏斗', '数据统计'];
    roles = ['销售员', '销售经理', '管理员'];
    dataObjects = ['客户', '跟进记录', '销售目标'];
  } else if (isEcom) {
    summary = '电商商城系统';
    targetUsers = ['普通买家', '商家', '管理员'];
    pages = ['首页', '商品列表', '商品详情', '购物车', '订单页', '个人中心'];
    features = ['商品浏览与搜索', '购物车管理', '下单支付', '订单管理', '用户中心'];
    roles = ['买家', '商家', '管理员'];
    dataObjects = ['商品', '订单', '用户', '购物车'];
  } else if (isOa) {
    summary = 'OA办公管理系统';
    targetUsers = ['员工', '部门主管', '管理员'];
    pages = ['首页', '审批流程', '考勤管理', '公告通知', '通讯录'];
    features = ['流程审批', '考勤管理', '公告通知', '文件共享'];
    roles = ['员工', '主管', '管理员'];
    dataObjects = ['用户', '审批单', '考勤记录', '公告'];
  } else if (isContent) {
    summary = '内容管理系统';
    targetUsers = ['编辑', '普通用户', '管理员'];
    pages = ['首页', '文章列表', '文章详情', '分类管理', '管理后台'];
    features = ['文章发布与管理', '分类标签', '评论管理', '搜索功能'];
    roles = ['管理员', '编辑', '普通用户'];
    dataObjects = ['文章', '分类', '标签', '评论', '用户'];
  } else if (isEdu) {
    summary = '在线教育系统';
    targetUsers = ['学生', '老师', '管理员'];
    pages = ['首页', '课程列表', '课程详情', '学习中心', '管理后台'];
    features = ['课程管理', '学员管理', '在线学习', '考试测评', '数据统计'];
    roles = ['管理员', '讲师', '学员'];
    dataObjects = ['课程', '学员', '考试', '学习记录'];
  } else if (isTask) {
    summary = '任务管理系统';
    targetUsers = ['项目经理', '团队成员'];
    pages = ['首页看板', '项目列表', '任务详情', '成员管理', '数据统计'];
    features = ['创建任务', '分配负责人', '设置截止日期', '看板视图', '进度统计'];
    roles = ['管理员', '项目经理', '成员'];
    dataObjects = ['项目', '任务', '用户', '评论'];
  }

  return {
    productName: summary,
    summary,
    background: `用户需要一个${summary}`,
    targetUsers,
    userPainPoints: ['现有流程效率低', '信息管理混乱'],
    useScenarios: ['日常工作管理'],
    coreValue: '提升工作效率，降低管理成本',
    productForm: '网页',
    mvpScope: features.slice(0, 3),
    successCriteria: ['核心功能可以正常使用', '用户能够独立完成操作'],
    pages,
    features,
    roles,
    dataObjects,
    riskPoints: ['需求可能还不够明确', '建议进一步确认用户真实场景'],
  };
}
