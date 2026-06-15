import { ScreenshotReplicateService } from './screenshot-replicate.service';

describe('ScreenshotReplicateService', () => {
  let llm: { vision: jest.Mock; chat: jest.Mock };
  let s: ScreenshotReplicateService;

  beforeEach(() => {
    llm = { vision: jest.fn(), chat: jest.fn() };
    s = new ScreenshotReplicateService(llm as never);
  });

  it('两段式：先 vision 出布局描述，再把描述喂给 text 生成，并清理 markdown 包裹', async () => {
    llm.vision.mockResolvedValue('{"layout":"左侧导航+右侧主区"}');
    llm.chat.mockResolvedValue('```html\n<!DOCTYPE html><html data-theme="corporate"><body>x</body></html>\n```');

    const html = await s.replicate('data:image/png;base64,AAA', '知识库');

    expect(llm.vision).toHaveBeenCalled();
    // 第二段用 text-primary，且把第一段的描述带进了 user
    expect(llm.chat).toHaveBeenCalledWith(
      'text-primary',
      expect.objectContaining({ user: expect.stringContaining('左侧导航+右侧主区') }),
      expect.anything(),
    );
    expect(html.startsWith('<!DOCTYPE')).toBe(true);
    expect(html).not.toContain('```');
  });

  it('vision 段用 vision 通道并传入图片 data url', async () => {
    llm.vision.mockResolvedValue('{}');
    llm.chat.mockResolvedValue('<html></html>');
    await s.replicate('data:image/png;base64,XYZ');
    expect(llm.vision).toHaveBeenCalledWith(expect.any(String), ['data:image/png;base64,XYZ'], expect.anything());
  });

  it('assembleMultiPage 把多页拼成 tab 切换 SPA，提取各页 body 内容', () => {
    const out = s.assembleMultiPage([
      { name: '首页', html: '<html><head><link href="daisyui"></head><body><div id="a">AAA</div></body></html>' },
      { name: '列表', html: '<html><body><div id="b">BBB</div></body></html>' },
    ]);
    expect(out).toContain('data-theme="corporate"');
    expect((out.match(/class="rpage/g) || []).length).toBe(2);
    expect(out).toContain('>首页<');
    expect(out).toContain('>列表<');
    expect(out).toContain('AAA');
    expect(out).toContain('BBB');
    expect(out).toContain('cdn.jsdelivr.net/npm/daisyui');
  });
});
