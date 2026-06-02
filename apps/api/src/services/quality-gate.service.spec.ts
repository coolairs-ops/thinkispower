import { QualityGateService, QualityCheck, QualityReport } from './quality-gate.service';

describe('QualityGateService', () => {
  let service: QualityGateService;

  beforeEach(() => {
    service = new QualityGateService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ═══ 结构类 4项 ═══
  describe('结构完整性检查', () => {
    const validHtml = '<!DOCTYPE html><html><head><title>T</title></head><body><div data-module-key="dash" data-module-key="list" onclick="navigate()">内容</div></body></html>';

    it('HTML结构完整性 — 完整HTML通过', () => {
      const r = service['checkHtmlStructure'](validHtml);
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('HTML结构完整性 — 缺失DOCTYPE降分', () => {
      const r = service['checkHtmlStructure']('<html><head></head><body></body></html>');
      expect(r.passed).toBe(false);
      expect(r.score).toBe(66);
    });

    it('HTML结构完整性 — 仅body最低分', () => {
      const r = service['checkHtmlStructure']('<body>hello</body>');
      expect(r.score).toBe(33);
    });

    it('批注标注 — 2个以上通过', () => {
      const r = service['checkDataAttributes'](validHtml);
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('批注标注 — 1个得50分', () => {
      const r = service['checkDataAttributes']('<div data-module-key="a">x</div>');
      expect(r.score).toBe(50);
    });

    it('批注标注 — 0个得0分', () => {
      const r = service['checkDataAttributes']('<div>no key</div>');
      expect(r.score).toBe(0);
      expect(r.recommendation).toBeTruthy();
    });

    it('导航交互 — navigate函数检测通过', () => {
      const r = service['checkNavigation']('<button onclick="navigate(\'list\')">go</button>');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('导航交互 — router.push检测通过', () => {
      const r = service['checkNavigation']('router.push("/users")');
      expect(r.passed).toBe(true);
    });

    it('导航交互 — 无导航得0分', () => {
      const r = service['checkNavigation']('<div>static</div>');
      expect(r.passed).toBe(false);
      expect(r.score).toBe(0);
    });

    it('无残留待办 — 无TODO/占位符通过', () => {
      const r = service['checkNoPlaceholders']('<div>已完成功能</div>');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('无残留待办 — 检测到TODO降分', () => {
      const r = service['checkNoPlaceholders']('// TODO: 实现删除功能\n<div>content</div>');
      expect(r.passed).toBe(false);
      expect(r.score).toBeLessThan(100);
    });

    it('无残留待办 — 多个待办项分数更低', () => {
      const r = service['checkNoPlaceholders']('TODO fix\nFIXME bug\nLorem ipsum');
      expect(r.score).toBeLessThanOrEqual(40);
    });
  });

  // ═══ 安全类 3项 ═══
  describe('安全检查', () => {
    it('无硬编码密钥 — 干净HTML通过', () => {
      const r = service['checkNoHardcodedSecrets']('<div>safe</div>');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('无硬编码密钥 — 检测到API key', () => {
      const r = service['checkNoHardcodedSecrets']('const key = "sk-12345678901234567890";');
      expect(r.passed).toBe(false);
      expect(r.score).toBe(0);
    });

    it('无硬编码密钥 — 检测到password赋值', () => {
      const r = service['checkNoHardcodedSecrets']('password = "admin123";');
      expect(r.passed).toBe(false);
    });

    it('无危险注入 — eval检测', () => {
      const r = service['checkNoDangerousInjection']('eval("alert(1)")');
      expect(r.passed).toBe(false);
      expect(r.score).toBe(0);
    });

    it('无危险注入 — innerHTML检测', () => {
      const r = service['checkNoDangerousInjection']('el.innerHTML = userInput;');
      // innerHTML with non-trivial assignment fails
      expect(r.score).toBe(0);
    });

    it('无危险注入 — 安全HTML通过', () => {
      const r = service['checkNoDangerousInjection']('<div>safe content</div>');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('CSP策略 — 有CSP得满分', () => {
      const r = service['checkCspMeta']('<meta http-equiv="Content-Security-Policy" content="default-src self">');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('CSP策略 — 无CSP得60分(非必需)', () => {
      const r = service['checkCspMeta']('<div>no csp</div>');
      expect(r.score).toBe(60);
      expect(r.recommendation).toBeTruthy();
    });
  });

  // ═══ UX类 3项 ═══
  describe('UX检查', () => {
    it('移动端适配 — 三者齐备满分', () => {
      const html = '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<style>@media (max-width:768px){.a{flex:1}}</style><div style="display:flex">x</div>';
      const r = service['checkMobileResponsive'](html);
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('移动端适配 — 仅viewport得40分', () => {
      const r = service['checkMobileResponsive']('<meta name="viewport" content="width=device-width">');
      expect(r.score).toBe(40);
    });

    it('移动端适配 — 全无得0分', () => {
      const r = service['checkMobileResponsive']('<div>desktop only</div>');
      expect(r.score).toBe(0);
    });

    it('图片可访问性 — 无图片通过', () => {
      const r = service['checkImageAccessibility']('<div>no images</div>');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('图片可访问性 — 全部有alt通过', () => {
      const r = service['checkImageAccessibility']('<img src="a.png" alt="logo"><img src="b.png" alt="banner">');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('图片可访问性 — 部分缺alt', () => {
      const r = service['checkImageAccessibility']('<img src="a.png" alt="ok"><img src="b.png">');
      expect(r.passed).toBe(false);
      expect(r.score).toBe(50);
    });

    it('表单验证 — 无表单通过', () => {
      const r = service['checkFormValidation']('<div>no form</div>');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('表单验证 — 有required+type通过', () => {
      const r = service['checkFormValidation']('<form><input required type="email" name="e"></form>');
      expect(r.passed).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(50);
    });

    it('表单验证 — 无任何验证得0', () => {
      const r = service['checkFormValidation']('<form><input name="e"></form>');
      expect(r.score).toBe(0);
    });
  });

  // ═══ 代码/部署类 3项（含自愈闸门） ═══
  describe('代码质量检查', () => {
    it('错误处理 — try-catch检测通过', () => {
      const r = service['checkErrorHandling']('try { fetch("/api"); } catch(e) { alert("失败"); }');
      expect(r.passed).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(40);
    });

    it('错误处理 — .catch链检测通过', () => {
      const r = service['checkErrorHandling']('fetch("/api").catch(err => console.error(err))');
      expect(r.passed).toBe(true);
    });

    it('错误处理 — 无异常处理得0', () => {
      const r = service['checkErrorHandling']('console.log("hello")');
      expect(r.score).toBeLessThan(40);
    });

    it('API就绪 — fetch调用通过', () => {
      const r = service['checkApiReadiness']('fetch("/api/users")');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('API就绪 — axios检测通过', () => {
      const r = service['checkApiReadiness']('import axios from "axios"; axios.get("/api/data")');
      expect(r.passed).toBe(true);
    });

    it('API就绪 — 无API调用得0', () => {
      const r = service['checkApiReadiness']('<div>static page</div>');
      expect(r.passed).toBe(false);
      expect(r.score).toBe(0);
    });

    it('无AI错误文本 — 干净HTML通过', () => {
      const r = service['checkNoErrorText']('<div>正常内容</div>');
      expect(r.passed).toBe(true);
      expect(r.score).toBe(100);
    });

    it('无AI错误文本 — AI抱歉检测', () => {
      const r = service['checkNoErrorText']('抱歉，我无法完成这个任务');
      expect(r.passed).toBe(false);
      expect(r.score).toBeLessThan(100);
    });

    it('无AI错误文本 — 超时错误检测', () => {
      const r = service['checkNoErrorText']('请求超时 Request timeout');
      expect(r.passed).toBe(false);
    });
  });

  // ═══ 聚合方法 ═══
  describe('runAllChecks', () => {
    it('完整HTML应全部通过', async () => {
      const html = '<!DOCTYPE html><html><head><title>App</title><meta name="viewport" content="width=device-width"></head><body><div data-module-key="dash" data-module-key="list" onclick="navigate(\'users\')"><form><input required type="email"></form></div><script>try{fetch("/api/users").then(r=>r.json())}catch(e){alert("错误")}</script></body></html>';
      const report = await service.runAllChecks('proj-1', html);
      expect(report.checks).toHaveLength(13);
      expect(report.score).toBeGreaterThanOrEqual(80);
      expect(report.categoryScores['structure']).toBeDefined();
      expect(report.categoryScores['security']).toBeDefined();
      expect(report.categoryScores['ux']).toBeDefined();
      expect(report.categoryScores['code']).toBeDefined();
    });

    it('空白HTML应大量未通过', async () => {
      const report = await service.runAllChecks('proj-1', '');
      expect(report.score).toBeLessThan(60);
      expect(report.passed).toBe(false);
    });

    it('包含TODO和eval的HTML应未通过多项', async () => {
      const html = 'TODO: fix this\n<script>eval("alert(1)")</script>';
      const report = await service.runAllChecks('proj-1', html);
      const todoCheck = report.checks.find(c => c.name.includes('待办'));
      const injectionCheck = report.checks.find(c => c.name.includes('注入'));
      expect(todoCheck?.passed).toBe(false);
      expect(injectionCheck?.passed).toBe(false);
    });
  });

  describe('detectFeatures', () => {
    it('空HTML得0', () => {
      expect(service.detectFeatures('')).toBe(0);
    });

    it('包含按钮+表单+搜索应得分', () => {
      const html = '<input type="text" placeholder="搜索用户"><button onclick="add()">添加</button><table><tr><td>data</td></tr></table>';
      const score = service.detectFeatures(html);
      expect(score).toBeGreaterThan(30);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('完整功能HTML应得高分', () => {
      const html = `
        <input type="text" placeholder="搜索">
        <button onclick="add()">添加</button>
        <button onclick="edit()">修改</button>
        <button onclick="del()">删除</button>
        <table><tr><td>data</td></tr></table>
        <div class="spinner loading">加载中</div>
        <style>@media (max-width:768px){.a{flex-wrap:wrap}}</style>
        <script>try{localStorage.setItem('k','v')}catch(e){}</script>
      `;
      const score = service.detectFeatures(html);
      expect(score).toBeGreaterThan(50);
    });
  });

  describe('computeMixedScore', () => {
    it('三个满分综合100', () => {
      expect(service.computeMixedScore(100, 100, 100)).toBe(100);
    });

    it('三者权重加权平均', () => {
      const score = service.computeMixedScore(80, 60, 50);
      expect(score).toBe(Math.round(80 * 0.4 + 60 * 0.3 + 50 * 0.3));
    });

    it('全0综合0', () => {
      expect(service.computeMixedScore(0, 0, 0)).toBe(0);
    });
  });
});
