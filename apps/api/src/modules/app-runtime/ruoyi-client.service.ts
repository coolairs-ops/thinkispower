import { Injectable, Logger } from '@nestjs/common';

/**
 * 若依 codegen REST 客户端（ADR-0003 M3b）。
 *
 * 据 M1 源码 + M3 实测确认的流程驱动 RuoYi-Vue-Plus 的 /tool/gen：
 *   login(拿JWT) → importTable(从已存在的表反射列) → findTableId → previewCode(返回 Map<文件,代码>)
 * 是 RuoyiRuntime.provision「实体→若依生成源码」那一步的真实接法（表创建 + build 部署属 M3c）。
 *
 * 起实例实测的坑已内化：多客户端登录带 clientId；接口加密/验证码需在实例侧关或由本端实现握手
 * （M3b 假定实例已关 api-decrypt/captcha，见 docs/architecture/ruoyi-integration-design.md §4）。
 */
export interface RuoyiClientConfig {
  baseUrl: string; // 如 http://127.0.0.1:8080
  clientId: string;
  username: string;
  password: string;
  tenantId: string;
}

@Injectable()
export class RuoyiClient {
  private readonly logger = new Logger(RuoyiClient.name);

  /** 登录拿 access_token。 */
  async login(cfg: RuoyiClientConfig): Promise<string> {
    const body = {
      clientId: cfg.clientId,
      grantType: 'password',
      username: cfg.username,
      password: cfg.password,
      tenantId: cfg.tenantId,
    };
    const data = await this.post(cfg, '/auth/login', body);
    const token = data?.data?.access_token;
    if (!token) throw new Error(`若依登录失败: ${JSON.stringify(data).slice(0, 200)}`);
    return token;
  }

  /** 从已存在的 DB 表反射列结构，导入 gen_table。 */
  async importTable(cfg: RuoyiClientConfig, token: string, tableName: string, dataName = 'master'): Promise<void> {
    const url = `/tool/gen/importTable?tables=${encodeURIComponent(tableName)}&dataName=${dataName}`;
    const data = await this.post(cfg, url, undefined, token);
    if (data?.code !== 200) throw new Error(`importTable 失败: ${JSON.stringify(data).slice(0, 200)}`);
  }

  /** 删 gen_table 里所有同名表的旧行（②：保证 importTable 后只剩一条，下游按表名取唯一）。无则跳过。 */
  private async clearGenTable(cfg: RuoyiClientConfig, token: string, tableName: string): Promise<void> {
    const data = await this.get(cfg, `/tool/gen/list?tableName=${encodeURIComponent(tableName)}`, token);
    const rows = (data?.rows ?? data?.data ?? []) as Array<{ tableId: number | string; tableName: string }>;
    const ids = rows.filter((r) => r.tableName === tableName && r.tableId != null).map((r) => r.tableId);
    if (!ids.length) return;
    await this.del(cfg, `/tool/gen/${ids.join(',')}`, token);
  }

  /** 按表名查 gen_table 的 tableId。 */
  async findTableId(cfg: RuoyiClientConfig, token: string, tableName: string): Promise<number> {
    const data = await this.get(cfg, `/tool/gen/list?tableName=${encodeURIComponent(tableName)}`, token);
    const rows = (data?.rows ?? data?.data ?? []) as Array<{ tableId: number; tableName: string }>;
    const row = rows.find((r) => r.tableName === tableName) ?? rows[0];
    if (!row?.tableId) throw new Error(`未找到 gen_table: ${tableName}`);
    return row.tableId;
  }

  /** 取 gen_table 元信息：若依按 business_name/module_name(非原表名)生成 vue 路径/组件/权限，建菜单必须对齐。 */
  async getGenMeta(cfg: RuoyiClientConfig, token: string, tableName: string): Promise<{ tableId: number; moduleName: string; businessName: string; functionName: string }> {
    const data = await this.get(cfg, `/tool/gen/list?tableName=${encodeURIComponent(tableName)}`, token);
    const rows = (data?.rows ?? data?.data ?? []) as Array<{ tableId: number; tableName: string; moduleName?: string; businessName?: string; functionName?: string }>;
    const row = rows.find((r) => r.tableName === tableName) ?? rows[0];
    if (!row?.tableId) throw new Error(`未找到 gen_table: ${tableName}`);
    return { tableId: row.tableId, moduleName: row.moduleName || 'system', businessName: row.businessName || tableName, functionName: row.functionName || tableName };
  }

  /** 预览生成代码：返回 { 文件名: 代码 }（内存，不落盘）。 */
  async previewCode(cfg: RuoyiClientConfig, token: string, tableId: number): Promise<Record<string, string>> {
    const data = await this.get(cfg, `/tool/gen/preview/${tableId}`, token);
    const files = (data?.data ?? {}) as Record<string, string>;
    if (Object.keys(files).length === 0) throw new Error(`preview 无产物: tableId=${tableId}`);
    return files;
  }

  /** 编排：登录→导表→取码。返回生成的源码文件集。 */
  async generate(cfg: RuoyiClientConfig, tableName: string): Promise<Record<string, string>> {
    const token = await this.login(cfg);
    await this.importTable(cfg, token, tableName);
    const tableId = await this.findTableId(cfg, token, tableName);
    const files = await this.previewCode(cfg, token, tableId);
    this.logger.log(`若依 codegen ${tableName}: 产出 ${Object.keys(files).length} 个文件`);
    return files;
  }

  /**
   * 下载生成代码 zip（download 端点，返回二进制）。
   * 与 preview 不同：zip 内是**正确的若依工程相对路径**（main/java/.../Xxx.java、main/resources/mapper/...），
   * 部署驱动据此落盘，无需手工映射模板名→路径。
   */
  async downloadZip(cfg: RuoyiClientConfig, token: string, tableId: number): Promise<Buffer> {
    const res = await fetch(`${cfg.baseUrl}/tool/gen/download/${tableId}`, {
      method: 'GET',
      headers: this.headers(token, cfg),
    });
    if (!res.ok) throw new Error(`download 失败: tableId=${tableId} HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error(`download 空 zip: tableId=${tableId}`);
    return buf;
  }

  /** 导表并下载 zip（部署驱动用）：登录→importTable→findTableId→downloadZip。 */
  async importAndDownload(cfg: RuoyiClientConfig, tableName: string, labels?: { functionName?: string; columns?: Record<string, string> }): Promise<Buffer> {
    const token = await this.login(cfg);
    await this.clearGenTable(cfg, token, tableName); // ② 清同名旧 gen_table 行，防多次置备累积 dup(下游 findTableId/getGenMeta 只能"挑一条"兜底)
    await this.importTable(cfg, token, tableName);
    const tableId = await this.findTableId(cfg, token, tableName);
    if (labels) await this.applyGenLabels(cfg, token, tableId, labels); // 下载前把中文标签写进 gen → vue/弹窗/列头自动中文(ADR-0012 ①)
    return this.downloadZip(cfg, token, tableId);
  }

  /** 把中文标签写进 codegen 配置：GET /tool/gen/{id} → 改 functionName + 各列 columnComment → PUT。失败只 warn 不阻断(回退英文)。 */
  async applyGenLabels(cfg: RuoyiClientConfig, token: string, tableId: number, labels: { functionName?: string; columns?: Record<string, string> }): Promise<void> {
    try {
      const data = await this.get(cfg, `/tool/gen/${tableId}`, token);
      const info = data?.data?.info as { functionName?: string } | undefined;
      const rows = data?.data?.rows as Array<{ columnName: string; columnComment?: string }> | undefined;
      if (!info || !Array.isArray(rows)) { this.logger.warn(`applyGenLabels: gen ${tableId} 无 info/rows，跳过`); return; }
      if (labels.functionName) info.functionName = labels.functionName;
      for (const row of rows) {
        const c = labels.columns?.[row.columnName];
        if (c) row.columnComment = c;
      }
      const put = await this.put(cfg, '/tool/gen', { ...info, columns: rows }, token);
      if (put?.code !== 200) this.logger.warn(`applyGenLabels PUT 非200(${tableId}): ${JSON.stringify(put).slice(0, 150)}`);
    } catch (e) {
      this.logger.warn(`applyGenLabels 失败(${tableId})，回退英文: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ─── RBAC 运行时配（混合管线：角色/数据权限走运行时 SQL，零重编译，见 ADR-0003 §4）───

  /** 已存在角色的 roleKey 集合（幂等 seed 用，避免重复建）。 */
  async listRoleKeys(cfg: RuoyiClientConfig, token: string): Promise<Set<string>> {
    const data = await this.get(cfg, `/system/role/list?pageNum=1&pageSize=200`, token);
    const rows = (data?.rows ?? data?.data?.rows ?? []) as Array<{ roleKey: string }>;
    return new Set(rows.map((r) => r.roleKey).filter(Boolean));
  }

  /**
   * 建角色（sys_role），核心是 dataScope 数据权限：'1'全部 / '5'仅本人（demo 修不出、若依开箱即有那块）。
   * menuIds 留空＝不挂菜单权限（超管不受限；普通角色的菜单挂载随 codegen 菜单 seed 后另配）。
   */
  async createRole(
    cfg: RuoyiClientConfig,
    token: string,
    role: { roleName: string; roleKey: string; dataScope: string; roleSort?: number; menuIds?: number[] },
  ): Promise<void> {
    const body = {
      roleName: role.roleName,
      roleKey: role.roleKey,
      roleSort: role.roleSort ?? 1,
      dataScope: role.dataScope,
      status: '0',
      menuCheckStrictly: true,
      deptCheckStrictly: true,
      menuIds: role.menuIds ?? [],
      deptIds: [],
    };
    const data = await this.post(cfg, '/system/role', body, token);
    if (data?.code !== 200) throw new Error(`createRole 失败(${role.roleKey}): ${JSON.stringify(data).slice(0, 200)}`);
  }

  /** 幂等 seed 一批角色：已存在 roleKey 跳过。返回新建数。 */
  async seedRoles(
    cfg: RuoyiClientConfig,
    roles: Array<{ roleName: string; roleKey: string; dataScope: string; roleSort?: number }>,
  ): Promise<{ created: number; skipped: number }> {
    const token = await this.login(cfg);
    const existing = await this.listRoleKeys(cfg, token);
    let created = 0;
    let skipped = 0;
    for (const r of roles) {
      if (existing.has(r.roleKey)) {
        skipped++;
        continue;
      }
      await this.createRole(cfg, token, r);
      created++;
    }
    this.logger.log(`若依 RBAC seed: 新建 ${created} 角色 / 跳过 ${skipped}（已存在）`);
    return { created, skipped };
  }

  // ─── 终端用户账号 seed（sys_user + 绑角色，data_scope 随角色；P2，供 LIVE 隔离验证/初始账号置备）───

  /** 列角色 roleKey→roleId（seedUsers 绑角色用；roleId 可能是雪花串）。 */
  async listRoles(cfg: RuoyiClientConfig, token: string): Promise<Map<string, string | number>> {
    const data = await this.get(cfg, `/system/role/list?pageNum=1&pageSize=200`, token);
    const rows = (data?.rows ?? data?.data?.rows ?? []) as Array<{ roleId: string | number; roleKey: string }>;
    return new Map(rows.filter((r) => r.roleKey).map((r) => [r.roleKey, r.roleId]));
  }

  /** 已存在用户名集合（幂等 seed 用）。 */
  async listUserNames(cfg: RuoyiClientConfig, token: string): Promise<Set<string>> {
    const data = await this.get(cfg, `/system/user/list?pageNum=1&pageSize=500`, token);
    const rows = (data?.rows ?? data?.data?.rows ?? []) as Array<{ userName: string }>;
    return new Set(rows.map((r) => r.userName).filter(Boolean));
  }

  /**
   * 建终端用户（sys_user）并绑角色——data_scope 随角色（普通用户=仅本人/管理=全部），
   * 是"普通用户只看自己、领导看全部"在运行时真生效的前提（每人调若依带本人 token）。
   * 幂等：已存在 userName 跳过。roleKey 解析为 roleId；deptId 默认 100（若依内置根部门）。
   */
  async seedUsers(
    cfg: RuoyiClientConfig,
    users: Array<{ userName: string; nickName?: string; password: string; roleKey: string; deptId?: number }>,
  ): Promise<{ created: number; skipped: number }> {
    const token = await this.login(cfg);
    const roleMap = await this.listRoles(cfg, token);
    const existing = await this.listUserNames(cfg, token);
    let created = 0;
    let skipped = 0;
    for (const u of users) {
      if (existing.has(u.userName)) {
        skipped++;
        continue;
      }
      const roleId = roleMap.get(u.roleKey);
      if (roleId == null) throw new Error(`seedUsers: 角色不存在 roleKey=${u.roleKey}`);
      const body = {
        userName: u.userName,
        nickName: u.nickName ?? u.userName,
        password: u.password,
        deptId: u.deptId ?? 100,
        roleIds: [roleId],
        status: '0',
      };
      const data = await this.post(cfg, '/system/user', body, token);
      if (data?.code !== 200) throw new Error(`createUser 失败(${u.userName}): ${JSON.stringify(data).slice(0, 200)}`);
      created++;
    }
    this.logger.log(`若依 seedUsers: 新建 ${created} 用户 / 跳过 ${skipped}（已存在）`);
    return { created, skipped };
  }

  // ─── 接口权限种子（坎1：生成的 Controller 带 @SaCheckPermission，角色没权限点→403）───

  /** 列现有菜单 perms→menuId（去重/取新建 id 用）。 */
  async listMenuPerms(cfg: RuoyiClientConfig, token: string): Promise<Map<string, string | number>> {
    const data = await this.get(cfg, `/system/menu/list`, token);
    const rows = (data?.data ?? data?.rows ?? []) as Array<{ menuId: string | number; perms: string }>;
    return new Map(rows.filter((r) => r.perms).map((r) => [r.perms, r.menuId]));
  }

  /** 建一个按钮权限点（menu_type=F，parentId=0）。perms 已存在应先经 listMenuPerms 去重避免重复建。 */
  private async createPermMenu(cfg: RuoyiClientConfig, token: string, perms: string, parentId: string | number = 0): Promise<void> {
    const body = { menuName: perms.slice(0, 50), parentId, menuType: 'F', perms, orderNum: 90, isFrame: '1', isCache: '0', visible: '0', status: '0', icon: '#' };
    const data = await this.post(cfg, '/system/menu', body, token);
    if (data?.code !== 200) throw new Error(`createMenu 失败(${perms}): ${JSON.stringify(data).slice(0, 200)}`);
  }

  /** 业务目录(menu_type=M, parent 0)；幂等：已存在同名目录返回其 id。生成的控制台页归到此一级目录。 */
  private async ensureBizDir(cfg: RuoyiClientConfig, token: string, name = '业务模块'): Promise<string | number> {
    const findDir = async (): Promise<string | number | undefined> => {
      const list = await this.get(cfg, '/system/menu/list', token);
      const arr = (list?.data ?? list?.rows ?? []) as Array<{ menuName?: string; menuType?: string; menuId?: string | number }>;
      return arr.find((m) => m.menuName === name && m.menuType === 'M')?.menuId;
    };
    const existing = await findDir();
    if (existing != null) return existing;
    const body = { menuName: name, parentId: 0, menuType: 'M', orderNum: 50, path: 'biz', isFrame: '1', isCache: '0', visible: '0', status: '0', icon: 'tree-table' };
    const data = await this.post(cfg, '/system/menu', body, token);
    if (data?.code !== 200) throw new Error(`建业务目录失败: ${JSON.stringify(data).slice(0, 150)}`);
    const id = await findDir();
    if (id == null) throw new Error('建业务目录后取 id 失败');
    return id;
  }

  /** 控制台页菜单(menu_type=C)：component=<module>/<resource>/index, perms=<module>:<resource>:list。让实体在若依控制台可导航。 */
  private async createConsoleMenu(cfg: RuoyiClientConfig, token: string, parentId: string | number, resource: string, menuName: string, moduleName: string): Promise<void> {
    const body = { menuName, parentId, menuType: 'C', path: resource, component: `${moduleName}/${resource}/index`, perms: `${moduleName}:${resource}:list`, orderNum: 1, isFrame: '1', isCache: '0', visible: '0', status: '0', icon: 'form' };
    const data = await this.post(cfg, '/system/menu', body, token);
    if (data?.code !== 200) throw new Error(`建控制台菜单失败(${resource}): ${JSON.stringify(data).slice(0, 200)}`);
  }

  /** 确保某菜单挂在指定业务目录下（自愈旧置备把 C 菜单建在「系统工具」等目录→角色没授其父目录→菜单被当孤儿丢弃不显示）。已在目标目录下则不动。 */
  private async ensureMenuUnderDir(cfg: RuoyiClientConfig, token: string, menuId: string | number, dirId: string | number): Promise<boolean> {
    const cur = await this.get(cfg, `/system/menu/${menuId}`, token);
    const menu = cur?.data;
    if (!menu || String(menu.parentId) === String(dirId)) return false;
    const put = await this.put(cfg, '/system/menu', { ...menu, parentId: dirId }, token);
    if (put?.code !== 200) throw new Error(`改菜单父级失败(${menuId}→${dirId}): ${JSON.stringify(put).slice(0, 150)}`);
    this.logger.log(`若依菜单改挂业务目录: menu=${menuId} parent→${dirId}`);
    return true;
  }

  /** 角色当前已绑菜单 id（roleMenuTreeselect.checkedKeys）。 */
  private async roleMenuCheckedKeys(cfg: RuoyiClientConfig, token: string, roleId: string | number): Promise<Array<string | number>> {
    const data = await this.get(cfg, `/system/menu/roleMenuTreeselect/${roleId}`, token);
    const checked = (data?.data?.checkedKeys ?? data?.checkedKeys ?? []) as Array<string | number>;
    // checkedKeys 只含叶子（父级 C/M 算"半选"不返回）。增量授权时 union 后整表 PUT 会把已绑父菜单覆盖删掉
    // （实测：分多次补单个资源时旧资源的 C 菜单消失）。用树的 parentId 把每个叶子的祖先补回，保证 union 不丢父级。
    const menus = (data?.data?.menus ?? data?.menus ?? []) as Array<{ id: string | number; parentId?: string | number; children?: unknown[] }>;
    const parentOf = new Map<string | number, string | number>();
    const flatten = (nodes: typeof menus) => {
      for (const n of nodes || []) {
        if (n.parentId != null) parentOf.set(n.id, n.parentId);
        if (Array.isArray(n.children) && n.children.length) flatten(n.children as typeof menus);
      }
    };
    flatten(menus);
    const full = new Set<string | number>(checked);
    for (const k of checked) {
      let p = parentOf.get(k);
      while (p != null && p !== 0 && p !== '0' && !full.has(p)) { full.add(p); p = parentOf.get(p); }
    }
    return Array.from(full);
  }

  /**
   * 给业务资源种按钮权限点（sys_menu）并绑给业务角色——解生成 Controller 的 @SaCheckPermission 403。
   * perms 对齐 codegen：`<module>:<resource>:<action>`（默认 module=system，actions=CRUD 五项）。
   * 幂等：已存在 perms 不重建；角色菜单取并集（保留原菜单 + dataScope/dept 不动）。
   */
  async seedMenusAndGrant(
    cfg: RuoyiClientConfig,
    resources: string[],
    roleKeys: string[],
    opts: { module?: string; actions?: string[]; labels?: Record<string, { functionName?: string }> } = {},
  ): Promise<{ menusCreated: number; rolesGranted: number }> {
    if (!resources.length || !roleKeys.length) return { menusCreated: 0, rolesGranted: 0 };
    const token = await this.login(cfg);
    const labels = opts.labels ?? {};
    const fActions = opts.actions ?? ['query', 'add', 'edit', 'remove', 'export']; // 'list' 由 C 页菜单承载
    // 按 gen_table 元信息派生路径/权限：若依按 business_name/module_name(剥表前缀)而非原表名生成 vue/控制器/权限。
    // function_name 已被 ① applyGenLabels 写成中文 → 直接作菜单名。
    const metas: Array<{ resource: string; moduleName: string; businessName: string; name: string }> = [];
    for (const r of resources) {
      try {
        const m = await this.getGenMeta(cfg, token, r);
        metas.push({ resource: r, moduleName: m.moduleName, businessName: m.businessName, name: m.functionName || labels[r]?.functionName || m.businessName });
      } catch (e) {
        this.logger.warn(`seedMenusAndGrant: 取 gen 元信息失败(${r})，跳过该资源: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!metas.length) return { menusCreated: 0, rolesGranted: 0 };
    const listPerms = metas.map((m) => `${m.moduleName}:${m.businessName}:list`);
    const fPerms = metas.flatMap((m) => fActions.map((a) => `${m.moduleName}:${m.businessName}:${a}`));

    let permMap = await this.listMenuPerms(cfg, token);
    let menusCreated = 0;
    // 业务一级目录（幂等）
    const dirId = await this.ensureBizDir(cfg, token);
    // 每资源建 C 页菜单（承载 list 权限，让控制台可导航；component/path/perms 用 businessName，菜单名用中文 functionName）
    for (const m of metas) {
      const existingCId = permMap.get(`${m.moduleName}:${m.businessName}:list`);
      if (existingCId != null) {
        // 旧置备可能把 C 菜单建在别的目录(如若依内置「系统工具」)下；项目角色只授「业务模块」目录
        // → 那些菜单父级未授、被若依菜单树当孤儿丢弃、授了却不显示。重新交付时改挂到业务模块目录自愈。
        await this.ensureMenuUnderDir(cfg, token, existingCId, dirId);
        continue;
      }
      await this.createConsoleMenu(cfg, token, dirId, m.businessName, m.name, m.moduleName);
      menusCreated++;
    }
    if (menusCreated) permMap = await this.listMenuPerms(cfg, token);
    // 每资源建 F 按钮权限点（挂在其 C 菜单下）
    for (const m of metas) {
      const cMenuId = permMap.get(`${m.moduleName}:${m.businessName}:list`) ?? 0;
      for (const a of fActions) {
        const p = `${m.moduleName}:${m.businessName}:${a}`;
        if (permMap.has(p)) continue;
        await this.createPermMenu(cfg, token, p, cMenuId);
        menusCreated++;
      }
    }
    if (menusCreated) permMap = await this.listMenuPerms(cfg, token); // 取新建的 menuId
    const wantMenuIds = [dirId, ...listPerms.map((p) => permMap.get(p)), ...fPerms.map((p) => permMap.get(p))].filter((x): x is string | number => x != null);

    // ② 绑给业务角色（并集；getRole 取全字段，PUT 带 menuIds，dataScope 不变）
    const roleMap = await this.listRoles(cfg, token);
    let rolesGranted = 0;
    for (const rk of roleKeys) {
      const roleId = roleMap.get(rk);
      if (roleId == null) continue;
      const current = await this.roleMenuCheckedKeys(cfg, token, roleId);
      const menuIds = Array.from(new Set<string | number>([...current, ...wantMenuIds]));
      const roleData = await this.get(cfg, `/system/role/${roleId}`, token);
      const role = roleData?.data;
      if (!role) throw new Error(`getRole 失败(${rk})`);
      const put = await this.put(cfg, '/system/role', { ...role, menuIds, deptIds: [] }, token);
      if (put?.code !== 200) throw new Error(`绑定角色菜单失败(${rk}): ${JSON.stringify(put).slice(0, 200)}`);
      rolesGranted++;
    }
    this.logger.log(`若依 seedMenusAndGrant: 资源 ${resources.length} / 权限点新建 ${menusCreated} / 绑定角色 ${rolesGranted}`);
    return { menusCreated, rolesGranted };
  }

  // ─── 终端用户数据代理（适配器②·服务端版：按**本人 token** 调 /system/<resource>，data_scope 据此生效）───
  // 路B appData 契约 ←→ 若依 REST 的转译统一收在这里（原在浏览器注入器里，现搬服务端，浏览器不见若依 token）。

  /** list：page/pageSize/filters → pageNum/pageSize/查询参；返回若依 {rows,total}。 */
  async dataList(
    cfg: RuoyiClientConfig,
    token: string,
    resource: string,
    q: { page?: number; pageSize?: number; filters?: Record<string, unknown> },
  ): Promise<{ rows: any[]; total: number }> {
    const qs = new URLSearchParams();
    qs.set('pageNum', String(q.page ?? 1));
    qs.set('pageSize', String(q.pageSize ?? 10));
    for (const [k, v] of Object.entries(q.filters ?? {})) if (v != null && v !== '') qs.set(k, String(v));
    const data = await this.get(cfg, `/system/${resource}/list?${qs.toString()}`, token);
    this.ensureOk(data, `list ${resource}`);
    return { rows: data?.rows ?? [], total: data?.total ?? 0 };
  }

  async dataGet(cfg: RuoyiClientConfig, token: string, resource: string, id: string): Promise<any> {
    const data = await this.get(cfg, `/system/${resource}/${encodeURIComponent(id)}`, token);
    this.ensureOk(data, `get ${resource}`);
    return data?.data;
  }

  async dataCreate(cfg: RuoyiClientConfig, token: string, resource: string, body: Record<string, unknown>): Promise<any> {
    const data = await this.post(cfg, `/system/${resource}`, body, token);
    this.ensureOk(data, `create ${resource}`);
    return data?.data;
  }

  /** update：若依 PUT 把 id 放 body。 */
  async dataUpdate(cfg: RuoyiClientConfig, token: string, resource: string, body: Record<string, unknown>): Promise<any> {
    const data = await this.put(cfg, `/system/${resource}`, body, token);
    this.ensureOk(data, `update ${resource}`);
    return data?.data;
  }

  async dataRemove(cfg: RuoyiClientConfig, token: string, resource: string, id: string): Promise<void> {
    const data = await this.del(cfg, `/system/${resource}/${encodeURIComponent(id)}`, token);
    this.ensureOk(data, `remove ${resource}`);
  }

  /** 若依以 HTTP 200 外壳 + body.code 表状态（鉴权失败是 200+code:401）；非 200 抛错，401 单独标。 */
  private ensureOk(data: any, what: string): void {
    const code = data?.code;
    if (code === 200) return;
    if (code === 401) throw new Error(`若依鉴权失败(${what})：${data?.msg ?? '需登录/clientid'}`);
    throw new Error(`若依${what}失败：${JSON.stringify(data).slice(0, 200)}`);
  }

  // ─── HTTP ───
  private headers(token?: string, cfg?: RuoyiClientConfig): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    if (cfg?.clientId) h.clientid = cfg.clientId;
    return h;
  }

  private async post(cfg: RuoyiClientConfig, path: string, body?: unknown, token?: string): Promise<any> {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(token, cfg),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  }

  private async get(cfg: RuoyiClientConfig, path: string, token?: string): Promise<any> {
    const res = await fetch(`${cfg.baseUrl}${path}`, { method: 'GET', headers: this.headers(token, cfg) });
    return res.json();
  }

  private async put(cfg: RuoyiClientConfig, path: string, body?: unknown, token?: string): Promise<any> {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.headers(token, cfg),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  }

  private async del(cfg: RuoyiClientConfig, path: string, token?: string): Promise<any> {
    const res = await fetch(`${cfg.baseUrl}${path}`, { method: 'DELETE', headers: this.headers(token, cfg) });
    return res.json();
  }
}
