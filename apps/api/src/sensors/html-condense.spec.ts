import { condenseHtmlForJudge } from './html-condense';

describe('condenseHtmlForJudge（验证器共用：去 style 噪声 + 不截断后半页）', () => {
  it('剥掉 <style> CSS 噪声、保留结构与 script', () => {
    const html = '<style>.x{color:red}</style><body><section>内容</section><script>appData.ask()</script></body>';
    const out = condenseHtmlForJudge(html);
    expect(out).not.toContain('color:red');
    expect(out).toContain('<section>内容</section>');
    expect(out).toContain('appData.ask()');
  });

  it('上限 36000 覆盖多页 demo：12000/15000 之后的内容不再被截', () => {
    const lateMarker = 'CHAT_PAGE_在线咨询';
    const html = '<style>' + 'z'.repeat(5000) + '</style>' + 'A'.repeat(15050) + lateMarker;
    const out = condenseHtmlForJudge(html);
    expect(out).toContain(lateMarker); // 原 slice(0,15000) 会丢（聊天页正好在 15038 字）
    expect(out).not.toContain('zzzzz');
  });

  it('超大 demo 仍按 cap 截断（有界）', () => {
    expect(condenseHtmlForJudge('B'.repeat(50000)).length).toBe(36000);
  });
});
