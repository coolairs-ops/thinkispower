import { tailwindCdnUrl, daisyuiCssUrl, daisyuiHeadAssets } from './asset-urls';

describe('asset-urls', () => {
  afterEach(() => {
    delete process.env.TAILWIND_CDN_URL;
    delete process.env.DAISYUI_CSS_URL;
  });

  it('默认走公网 CDN', () => {
    expect(tailwindCdnUrl()).toContain('cdn.tailwindcss.com');
    expect(daisyuiCssUrl()).toContain('daisyui');
    expect(daisyuiHeadAssets()).toContain('<link');
  });

  it('env 可覆盖为域内地址（私有化）', () => {
    process.env.TAILWIND_CDN_URL = 'http://intra/tw.js';
    process.env.DAISYUI_CSS_URL = 'http://intra/ds.css';
    expect(tailwindCdnUrl()).toBe('http://intra/tw.js');
    expect(daisyuiCssUrl()).toBe('http://intra/ds.css');
    expect(daisyuiHeadAssets()).toContain('http://intra/ds.css');
  });
});
