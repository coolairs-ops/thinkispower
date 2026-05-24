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
仅输出 HTML 代码，包裹在 \`\`\`html...\`\`\` 中。不输出解释。`;

@Injectable()
export class DemoGeneratorService {
  private readonly logger = new Logger(DemoGeneratorService.name);

  constructor(private deepseek: DeepseekService) {}

  async generateDemoHtml(plan: PlanResult): Promise<string> {
    const prompt = this.buildPrompt(plan);

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

  private toKebabCase(str: string): string {
    return str
      .replace(/[^\w一-龥]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      || 'module';
  }
}
