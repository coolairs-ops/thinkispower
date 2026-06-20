import { buildRuoyiAppDataScript, injectRuoyiAppData } from './ruoyi-appdata.injector';

describe('若依版 appData 注入器（适配器②）', () => {
  const opts = { baseUrl: 'http://127.0.0.1:8080', clientId: 'cid' };

  it('脚本定义 window.appData 的 5 个方法，且映射到若依端点/响应', () => {
    const s = buildRuoyiAppDataScript(opts);
    // 同接口
    for (const m of ['list:', 'get:', 'create:', 'update:', 'remove:']) expect(s).toContain(m);
    // 端点：/system/<resource>
    expect(s).toContain("'/system/'+");
    // list 用若依分页(pageNum/pageSize) + 取 rows/total
    expect(s).toContain('pageNum=');
    expect(s).toContain('r.rows');
    expect(s).toContain('r.total');
    // 鉴权：读注入 token + clientid，不含明文密码
    expect(s).toContain('window.__RUOYI_TOKEN__');
    expect(s).toContain("h['clientid']=CID");
    expect(s).not.toMatch(/password|admin123/i);
    // update 走 PUT 且 id 进 body（若依约定）
    expect(s).toContain("req('PUT'");
    expect(s).toContain('b.id=id');
  });

  it('resourceMap 覆盖资源名→若依业务名', () => {
    const s = buildRuoyiAppDataScript({ ...opts, resourceMap: { demoMember: 'member' } });
    expect(s).toContain('"demoMember":"member"');
  });

  it('注入到 <head>，带 token 时先注入 token 全局', () => {
    const html = '<html><head><title>画像</title></head><body>x</body></html>';
    const out = injectRuoyiAppData(html, { ...opts, token: 'tok-123' });
    expect(out).toContain('window.__RUOYI_TOKEN__="tok-123"');
    expect(out.indexOf('__RUOYI_TOKEN__')).toBeLessThan(out.indexOf('window.appData')); // token 先于 appData
    expect(out).toContain('</head>');
    expect(out.indexOf('window.appData')).toBeLessThan(out.indexOf('</head>'));
  });

  it('无 </head> 时注入 <body> 开头；都无则前置', () => {
    expect(injectRuoyiAppData('<body>x</body>', opts)).toMatch(/<body>\n<script/);
    expect(injectRuoyiAppData('纯文本', opts)).toMatch(/^<script/);
  });

  it('无 token 时不注入 token 全局（私有化用若依会话）', () => {
    const out = injectRuoyiAppData('<head></head>', opts);
    expect(out).not.toContain('__RUOYI_TOKEN__=');
    expect(out).toContain('window.appData');
  });
});
