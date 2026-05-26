import { Injectable, Logger } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';
import { PlanResult } from './plan-generator.service';

const DEMO_SYSTEM_PROMPT = `你是一个应用原型生成器。根据需求生成一个完整的单文件 HTML 应用预览。

## 关键要求

1. **多页面 SPA 结构**：每个模块是一张独立页面，通过左侧导航栏切换，而不是在同一个页面里做显隐切换。
   - 每个模块对应一个完整的页面视图，有自己的标题、内容和操作区
   - 导航通过点击侧边栏菜单项 + JavaScript 直接切换内容区（使用 onclick + navigate() 函数）
   - 页面切换时，主内容区完全替换为新页面的内容，而非显示/隐藏已有元素
   - 每个页面都是独立的"页面级别"视图，有自己的页面标题
   - 不得出现多个模块内容同时存在于 DOM 中通过 display:none 切换的情况

2. **可点击批注就绪**：每个交互元素必须有这两个属性：
   - \`data-module-key="{模块key}"\` — 表示属于哪个模块
   - \`data-element-path="{有意义的路径名}"\` — 使用 kebab-case 命名

3. **属性注入规则**（必须遵守）：
   - **侧边栏菜单项和页面标题不要加 data-module-key**，避免干扰页面导航
   - 每个按钮、表格、输入框必须有 data-module-key 和 data-element-path
   - 每个统计卡片或数据展示器必须有 data-module-key
   - 每个列表项、可点击的操作项必须有 data-module-key 和 data-element-path

4. **UI 风格**：
   - 现代简洁的管理面板风格
   - 使用内联 CSS 或 <style> 块（无外部依赖）
   - 浅色主题，带微妙边框和阴影
   - 左侧边栏 + 右侧主内容区
   - 左侧边栏列出所有模块名称，点击切换对应页面

5. **技术约束**：
   - 单个 HTML 文件，无外部资源
   - CSS grid/flexbox 布局
   - 使用模拟数据展示
   - 纯静态 HTML+CSS+JS

6. **点击交互 JS**（必须包含在内）：
   - 在 HTML 底部添加以下 JavaScript（写在 <script> 标签中）
   - 为所有带 data-module-key 属性的元素添加点击事件监听
   - 点击时通过 window.parent.postMessage 通知父窗口
   - 具体实现：
   \`\`\`js
   document.addEventListener('click', function(e) {
     var el = e.target.closest('[data-module-key]');
     if (el) {
       window.parent.postMessage({
         type: 'element-click',
         moduleKey: el.getAttribute('data-module-key'),
         elementPath: el.getAttribute('data-element-path') || ''
       }, '*');
     }
   });
   \`\`\`

   > 注意：不要调用 preventDefault() 或 stopPropagation()，否则侧边栏导航菜单点击会被阻塞，导致无法切换模块。

7. **父页面高亮监听器**（必须包含）：
   - 在 <style> 中添加 .annotation-highlight CSS 类
   - 在 <script> 中添加 window.addEventListener('message')，接收来自父页面的高亮/清除命令
   - CSS 样式：
   \`\`\`css
   .annotation-highlight {
     outline: 3px solid #3b82f6;
     outline-offset: 2px;
     background-color: rgba(59, 130, 246, 0.08);
     border-radius: 4px;
   }
   \`\`\`
   - 消息监听器实现（放在 <script> 中，在现有点击处理器之后）：
   \`\`\`js
   window.addEventListener('message', function(e) {
     if (e.data && e.data.type === 'highlight-element') {
       document.querySelectorAll('.annotation-highlight').forEach(function(el) {
         el.classList.remove('annotation-highlight');
       });
       var selector = '[data-module-key="' + e.data.moduleKey + '"]';
       if (e.data.elementPath) {
         selector += '[data-element-path="' + e.data.elementPath + '"]';
       }
       var target = document.querySelector(selector);
       if (target) {
         target.classList.add('annotation-highlight');
         target.scrollIntoView({ behavior: 'smooth', block: 'center' });
       }
     } else if (e.data && e.data.type === 'clear-highlight') {
       document.querySelectorAll('.annotation-highlight').forEach(function(el) {
         el.classList.remove('annotation-highlight');
       });
     }
   });
   \`\`\`

8. **多页面路由 JS 实现示例**（必须使用类似方案，**不要使用 hashchange 事件**）：
   \`\`\`js
   // 页面定义：每个模块是一个独立的页面渲染函数
   var pages = {
     'dashboard': { render: function() { /* 返回完整页面 HTML */ }, name: '首页看板' },
     'customer-list': { render: function() { /* 返回完整页面 HTML */ }, name: '客户列表' },
     // ... 每个模块一个
   };

   // 路由切换：直接通过 key 切换，替换主内容区，而不是显示/隐藏
   function navigate(key) {
     var page = pages[key];
     if (page) {
       document.getElementById('main-content').innerHTML = page.render();
       // 高亮当前导航项
       document.querySelectorAll('.nav-item').forEach(function(el) {
         el.classList.toggle('active', el.getAttribute('data-route') === key);
       });
     }
   }

   // 初始加载时导航到第一个模块
   navigate('dashboard');

   // 侧边栏导航：使用 onclick 直接调用 navigate，不要用 href=#
   // <a class="nav-item" data-route="customer-list" onclick="navigate('customer-list')">客户列表</a>
   \`\`\`
   > 注意：侧边栏菜单项使用 \`onclick="navigate('模块key')"\` 直接切换页面，**不要使用 \`<a href="#key">\` 或 hashchange 事件**（iframe 内 hashchange 可能不触发）。**禁止使用 display:none 做显隐切换**。

## 输出格式
仅输出 HTML 代码，包裹在 \`\`\`html...\`\`\` 中。不输出解释。

9. **业务逻辑模拟**（必须包含）：
   - 使用 JavaScript 对象模拟数据层：\`var dataStore = { ... }\` 存储所有模拟数据
   - 每个模块页面包含对应的数据 CRUD 操作（添加表单、行编辑、删除确认）
   - 实现自动计算逻辑（根据条件自动计算状态、金额、进度百分比等）
   - 表单提交时更新 dataStore，并重新渲染对应的列表/统计区域
   - 示例结构：
   \`\`\`js
   var dataStore = {
     customers: [
       { id: 1, name: '张三', level: '普通', amount: 5000, createdAt: '2026-01-15' },
       { id: 2, name: '李四', level: 'VIP', amount: 35000, createdAt: '2026-02-20' }
     ],
     orders: [
       { id: 1001, customerId: 1, total: 1200, status: '已完成' }
     ]
   };
   function renderCustomerList() { /* 从 dataStore 渲染表格 */ }
   function addCustomer() { /* 弹出表单 → 推入 dataStore → 重新渲染 */ }
   function deleteCustomer(id) { /* 确认 → 从 dataStore 删除 → 重新渲染 */ }
   \`\`\`

10. **角色 / 权限模拟**（如果计划中指定了多个角色则必须包含）：
    - 在页面顶部导航栏添加 mock 用户角色切换器（下拉选择或按钮组）
    - 每个角色配备不同的可访问菜单项和操作权限
    - 切换角色后侧边栏菜单和页面内容按角色权限变化
    - 角色切换不影响 dataStore 中的数据
    - 示例：
    \`\`\`js
    var currentRole = 'admin';
    function switchRole(role) {
      currentRole = role;
      renderSidebar();
      navigate('dashboard');
    }
    var rolePermissions = {
      admin: { menus: ['dashboard','customers','orders','settings'], canDelete: true },
      sales: { menus: ['dashboard','customers','orders'], canDelete: false },
      viewer: { menus: ['dashboard'], canDelete: false }
    };
    \`\`\`

11. **数据关联导航**：
    - 列表项点击后进入详情页（如客户详情、订单详情），而不是停留在同一页面
    - 详情页展示该对象的完整信息以及关联数据（如客户详情中显示关联的订单列表）
    - 详情页有返回按钮回到列表页
    - 示例：
    \`\`\`js
    function showCustomerDetail(id) {
      var customer = dataStore.customers.find(function(c) { return c.id === id; });
      var orders = dataStore.orders.filter(function(o) { return o.customerId === id; });
      document.getElementById('main-content').innerHTML =
        '<h2>' + customer.name + '</h2>' +
        '<h3>关联订单</h3>' +
        renderOrderTable(orders) +
        '<button onclick="navigate(\\'customers\\')">返回列表</button>';
    }
    \`\`\`

12. **数据持久化**：
    - 使用 \`localStorage\` 持久化 dataStore，刷新页面数据不丢失
    - 在页面加载时从 localStorage 恢复数据
    - 每次 dataStore 变更时保存到 localStorage
    - 示例：
    \`\`\`js
    if (localStorage.getItem('appData')) {
      dataStore = JSON.parse(localStorage.getItem('appData'));
    }
    function saveData() {
      localStorage.setItem('appData', JSON.stringify(dataStore));
    }
    \`\`\``;

@Injectable()
export class DemoGeneratorService {
  private readonly logger = new Logger(DemoGeneratorService.name);

  constructor(private deepseek: DeepseekService) {}

  async generateDemoHtml(plan: PlanResult, improvements?: string): Promise<string> {
    const prompt = improvements
      ? this.buildPrompt(plan) + `\n\n## 上次生成的改进意见\n请根据以下改进意见重新生成演示：\n${improvements}`
      : this.buildPrompt(plan);

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: DEMO_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 8192 },
    );

    const html = this.extractHtml(response);
    this.validateHtml(html, plan);
    return html;
  }

  private buildPrompt(plan: PlanResult): string {
    const modules = (plan.pages || []).map((p, i) => {
      const key = this.toKebabCase(p.split(' ')[0] || `page-${i + 1}`);
      return `  { "key": "${key}", "name": "${p}" }`;
    }).join('\n');

    return `## 项目规范

### 页面模块（每个模块是一张独立页面，通过 hash 路由切换）
${modules}

### 功能
${plan.features.map((f) => `  - ${f}`).join('\n')}

### 角色
${plan.roles.map((r) => `  - ${r}`).join('\n')}

### 数据对象
${plan.dataObjects.map((d) => `  - ${d}`).join('\n')}

### 项目摘要
${plan.summary}

请生成包含所有页面的完整 SPA 管理面板。每个页面模块都是一张独立页面视图，通过左侧导航栏 + hash 路由切换，不得在同一个页面里做显隐切换。`;
  }

  private extractHtml(response: string): string {
    const htmlMatch = response.match(/```html\s*([\s\S]*?)\s*```/);
    if (htmlMatch) return htmlMatch[1].trim();

    const codeMatch = response.match(/```\s*([\s\S]*?)\s*```/);
    if (codeMatch) return codeMatch[1].trim();

    if (response.includes('<html') || response.includes('<!DOCTYPE')) {
      return response.trim();
    }

    throw new Error('DeepSeek 响应中未找到有效的 HTML 输出');
  }

  private validateHtml(html: string, plan: PlanResult): void {
    const hasModuleKeys = (plan.pages || []).some((p) => {
      const key = this.toKebabCase(p.split(' ')[0] || '');
      return key && html.includes(`data-module-key="${key}"`);
    });

    if (!hasModuleKeys) {
      this.logger.warn('生成的 HTML 缺少 data-module-key 属性，将降低批注精度');
    }

    if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
      throw new Error('生成的 HTML 缺少标准文档结构');
    }
  }

  async evaluateDemo(html: string, plan: PlanResult): Promise<{ score: number; missingItems: string[]; details: string }> {
    const evalPrompt = `你是一个演示质量评估专家。评估生成的 HTML 演示是否充分展示了产品功能。

## 规划信息
### 功能清单
${plan.features.map((f) => `  - ${f}`).join('\n')}

### 角色
${plan.roles.map((r) => `  - ${r}`).join('\n')}

### 验收标准
${plan.acceptanceChecklist.map((c) => `  - ${c}`).join('\n')}

## 评估维度
1. 功能覆盖率（0-40分）：规划中的功能在演示中实现了多少？是否可用？
2. 交互完整度（0-30分）：表单是否可填写提交？按钮是否有响应？状态变更是否模拟？
3. 角色覆盖（0-15分）：多角色时是否体现了不同角色的视图和权限差异？
4. 数据关联（0-15分）：关联数据是否能导航展示？（如客户详情中显示关联订单）

## 输出格式
仅输出 JSON：
{"score": 0, "missingItems": ["缺失项1"], "details": "评分理由"}`;

    const response = await this.deepseek.chat(
      [
        { role: 'system', content: '你是一个严格的质量评估专家。请基于规划信息评估以下 HTML 演示。' },
        { role: 'user', content: `## HTML 演示\n\n${html.slice(0, 15000)}\n\n## 评估任务\n${evalPrompt}` },
      ],
      { temperature: 0.3, maxTokens: 2048 },
    );

    try {
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        score: parsed.score || 0,
        missingItems: Array.isArray(parsed.missingItems) ? parsed.missingItems : [],
        details: parsed.details || '',
      };
    } catch {
      this.logger.warn('Demo 质量评估解析失败，使用默认评分');
      return { score: 50, missingItems: ['评估解析失败'], details: 'AI 返回格式异常，请人工审查' };
    }
  }

  private toKebabCase(str: string): string {
    return str
      .replace(/[^\w一-龥]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      || 'module';
  }
}
