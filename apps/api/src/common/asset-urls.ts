/**
 * daisyUI / Tailwind 前端资源地址（R3 私有化自托管）。
 *
 * 默认走公网 CDN；私有化部署时设 env 指向域内静态托管(MinIO/nginx/API 静态)即可，
 * 生成与拼装的 demo 都会引用域内地址，守"数据/资源不出域"。
 *   TAILWIND_CDN_URL  例：http://内网/assets/tailwind.js（或预编译 css）
 *   DAISYUI_CSS_URL   例：http://内网/assets/daisyui-full.min.css
 */
export const tailwindCdnUrl = (): string => process.env.TAILWIND_CDN_URL || 'https://cdn.tailwindcss.com';

export const daisyuiCssUrl = (): string =>
  process.env.DAISYUI_CSS_URL || 'https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css';

/** demo <head> 里引入 daisyUI/Tailwind 的片段 */
export const daisyuiHeadAssets = (): string =>
  `<script src="${tailwindCdnUrl()}"></script>\n<link href="${daisyuiCssUrl()}" rel="stylesheet" type="text/css"/>`;
