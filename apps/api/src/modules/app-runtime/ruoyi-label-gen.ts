import { Logger } from '@nestjs/common';
import { DeepseekService } from '../../services/deepseek.service';
import { ParsedModel } from './data-model.types';

/**
 * 控制台中文标签（ADR-0012 ① 自动化）：LLM 据表/字段英文名产中文 functionName + 字段标签。
 * 用于若依 codegen：写进 gen_table.function_name / gen_table_column.column_comment → vue/弹窗/列头自动中文。
 *
 * 健壮性（2026-06-28 加固）：先用**确定性词典**为常见字段/实体铺中文兜底，再用 LLM 增强按字段覆盖。
 * 这样 DeepSeek 抽风(ECONNRESET)/返非法 JSON 时**不再裸回退纯英文**，常见字段仍是中文；LLM 成功则取其更贴切的译法。
 */
export type ConsoleLabels = Record<string, { functionName: string; columns: Record<string, string> }>;

/** 若依框架列已自带中文注释，不送 LLM、不覆盖。 */
const FRAMEWORK = new Set(['create_dept', 'create_by', 'create_time', 'update_by', 'update_time', 'tenant_id', 'del_flag', 'version']);
const logger = new Logger('RuoyiLabelGen');

/** 归一：小写 + 去非字母数字（customerId/customer_id → customerid）。 */
const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** 常见字段名 → 中文（确定性兜底词典）。键为归一后形式。 */
const COL_DICT: Record<string, string> = {
  id: '编号', code: '编码', no: '编号', number: '编号', serialno: '序列号',
  name: '名称', title: '标题', fullname: '姓名', nickname: '昵称', username: '用户名',
  status: '状态', state: '状态', type: '类型', category: '分类', kind: '类型', level: '等级', grade: '等级', priority: '优先级', flag: '标记', result: '结果',
  amount: '金额', price: '价格', money: '金额', cost: '成本', total: '合计', fee: '费用', balance: '余额', discount: '折扣', tax: '税额',
  qty: '数量', quantity: '数量', count: '数量', num: '数量', stock: '库存', stockqty: '库存', inventory: '库存',
  phone: '电话', mobile: '手机号', tel: '电话', telephone: '电话', fax: '传真', email: '邮箱', mail: '邮箱',
  address: '地址', addr: '地址', location: '位置', region: '区域', area: '区域', city: '城市', province: '省份', country: '国家', zipcode: '邮编', postcode: '邮编',
  contact: '联系方式', contactinfo: '联系方式', contacts: '联系方式', contactperson: '联系人', linkman: '联系人',
  remark: '备注', remarks: '备注', note: '备注', notes: '备注', memo: '备注', summary: '摘要', comment: '备注', comments: '备注',
  description: '描述', desc: '描述', detail: '详情', details: '详情', content: '内容', body: '内容', text: '文本',
  date: '日期', time: '时间', datetime: '时间', startdate: '开始日期', starttime: '开始时间', begintime: '开始时间', enddate: '结束日期', endtime: '结束时间',
  deadline: '截止日期', duedate: '截止日期', expiry: '到期时间', expirydate: '到期日期', expirytime: '到期时间', visittime: '拜访时间',
  createdat: '创建时间', createtime: '创建时间', createdtime: '创建时间', gmtcreate: '创建时间', updatedat: '更新时间', updatetime: '更新时间', gmtmodified: '更新时间',
  userid: '负责人', ownerid: '负责人', owner: '负责人', creatorid: '创建人', creator: '创建人', operator: '操作人', handler: '处理人', inspectorid: '检查人', inspector: '检查人', assigneeid: '指派人', assignee: '指派人',
  customerid: '客户', customer: '客户', clientid: '客户', client: '客户', supplierid: '供应商', supplier: '供应商', vendorid: '供应商',
  deptid: '部门', dept: '部门', department: '部门', orgid: '组织', org: '组织', companyid: '公司', company: '公司',
  projectid: '项目', project: '项目', orderid: '订单', order: '订单', productid: '商品', product: '商品', goodsid: '商品', goods: '商品',
  sort: '排序', sortorder: '排序', ordernum: '排序', orderno: '排序', seq: '排序', sequence: '排序', weight: '权重',
  lat: '纬度', latitude: '纬度', lng: '经度', lon: '经度', longitude: '经度',
  url: '链接', urls: '链接', link: '链接', links: '链接', photo: '照片', photos: '照片', photourl: '照片', photourls: '照片', image: '图片', images: '图片', img: '图片', pic: '图片',
  video: '视频', videos: '视频', videourl: '视频', videourls: '视频', voice: '语音', voiceurl: '语音', audio: '音频', file: '附件', files: '附件', attachment: '附件', attachments: '附件',
  enabled: '是否启用', enable: '是否启用', active: '是否启用', isactive: '是否启用', visible: '是否显示', deleted: '是否删除', isdeleted: '是否删除',
  completed: '是否完成', finished: '是否完成', done: '是否完成', isdone: '是否完成', progress: '进度', score: '分数', rating: '评分', percent: '百分比',
  age: '年龄', gender: '性别', sex: '性别', birthday: '生日', birthdate: '出生日期', idcard: '身份证号', avatar: '头像',
};

/** 常见实体名 → 中文（functionName 兜底；LLM 失败时菜单/页标题仍尽量中文）。 */
const FN_DICT: Record<string, string> = {
  store: '门店', shop: '门店', customer: '客户', client: '客户', order: '订单', product: '商品', goods: '商品',
  task: '任务', project: '项目', user: '用户', member: '会员', supplier: '供应商', vendor: '供应商',
  employee: '员工', staff: '员工', department: '部门', dept: '部门', role: '角色', menu: '菜单', notice: '通知',
  visitrecord: '拜访记录', visit: '拜访', route: '路线', routeplan: '路线计划', plan: '计划', dailystats: '日统计', stats: '统计', statistics: '统计',
  invoice: '发票', payment: '支付', contract: '合同', account: '账户', record: '记录', log: '日志', report: '报表', category: '分类',
};

const fallbackColumn = (field: string): string | undefined => COL_DICT[norm(field)];
const fallbackFunction = (table: string, name: string): string => FN_DICT[norm(table)] || FN_DICT[norm(name)] || name;

export async function generateConsoleLabels(deepseek: DeepseekService | undefined, entities: ParsedModel[]): Promise<ConsoleLabels> {
  if (!entities?.length) return {};

  // ① 确定性兜底基线：常见字段/实体先铺中文（LLM 抽风也不裸回退英文）
  const out: ConsoleLabels = {};
  for (const e of entities) {
    const cols: Record<string, string> = {};
    for (const f of e.fields) {
      if (FRAMEWORK.has(f.name.toLowerCase())) continue;
      const zh = fallbackColumn(f.name);
      if (zh) cols[f.name] = zh;
    }
    out[e.table] = { functionName: fallbackFunction(e.table, e.name), columns: cols };
  }
  if (!deepseek) {
    logger.log(`中文标签(确定性兜底): ${entities.length} 表`);
    return out;
  }

  // ② LLM 增强：成功则按字段覆盖兜底（更贴业务的译法）；失败保留兜底
  const spec = entities.map((e) => ({
    table: e.table,
    name: e.name,
    fields: e.fields.map((f) => f.name).filter((n) => !FRAMEWORK.has(n.toLowerCase())),
  }));
  const system =
    '你是中文业务系统的标签生成器。给定数据库表与字段(英文)，产出简洁中文标签。' +
    '只输出一个 JSON 对象、无任何解释：{"表名":{"functionName":"中文业务名","columns":{"字段名":"中文标签"}}}。' +
    'functionName 用业务名词(如 客户/项目/订单)；字段标签简短(name→名称, amount→金额, contactInfo→联系方式, userId→负责人, createdAt→创建时间, status→状态)。表名/字段名必须原样作 key、不要翻译 key。';
  const user = '表与字段：\n' + spec.map((e) => `表 ${e.table}(${e.name})：${e.fields.join(', ') || '(无业务字段)'}`).join('\n');

  let raw: Record<string, { functionName?: string; columns?: Record<string, string> }> | null = null;
  for (let attempt = 1; attempt <= 2 && !raw; attempt++) {
    try {
      const resp = await deepseek.chatWithRetry([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.2, maxTokens: 1500 });
      if (!resp) continue;
      const s = resp.indexOf('{'), en = resp.lastIndexOf('}');
      if (s < 0 || en <= s) continue;
      raw = JSON.parse(resp.slice(s, en + 1));
    } catch (e) {
      logger.warn(`LLM 标签第 ${attempt} 次失败: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!raw) {
    logger.warn('LLM 标签全部失败，用确定性兜底词典');
    return out;
  }
  for (const e of entities) {
    const r = raw[e.table];
    if (!r) continue;
    if (typeof r.functionName === 'string' && r.functionName) out[e.table].functionName = r.functionName;
    for (const f of e.fields) {
      const v = r.columns?.[f.name];
      if (typeof v === 'string' && v) out[e.table].columns[f.name] = v;
    }
  }
  logger.log(`中文标签(LLM 增强+兜底): ${entities.length} 表`);
  return out;
}
