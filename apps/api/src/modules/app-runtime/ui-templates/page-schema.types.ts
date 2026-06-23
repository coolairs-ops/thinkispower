/**
 * 页面 Schema（ADR-0007 应用契约先行的渲染侧 / Schema 驱动 S1）。
 *
 * LLM 产出的不是 HTML 而是这份结构化「页面装配清单」：App → pages[] → blocks[]，
 * 每个块 = { type, bind, props }。type 取自固定组件库（长相由渲染器+主题控，可控好看）；
 * bind 指向数据契约的资源/字段（可引用、可校验、真绑 appData）；props 是细节配置。
 * 用户编辑的是这份 JSON（加删改块/改绑定），不碰 HTML。
 */

/** 数据绑定：指向数据契约的资源（表名）与字段。 */
export interface Bind {
  resource: string;
  fields?: string[];
}

export type Block =
  | { type: 'kpi'; bind: { resource: string }; props: { label: string } }
  | { type: 'table'; bind: Bind; props?: { title?: string; searchable?: boolean; rowActions?: string[]; badges?: string[] } }
  | { type: 'detail'; bind: Bind; props?: { title?: string } }
  | { type: 'form'; bind: Bind; props?: { title?: string; mode?: 'create' | 'edit'; submitLabel?: string } }
  | { type: 'generate'; bind: Bind; props?: { title?: string; inputField?: string; inputLabel?: string; button?: string } }
  | { type: 'richtext'; props: { html: string } };

export type BlockType = Block['type'];

export interface Page {
  key: string;                       // 路由/锚点键（页内唯一）
  title: string;
  nav?: { icon?: string; label?: string }; // 进侧栏的图标/标签（缺省用 title）
  blocks: Block[];
}

export interface AppSchema {
  appName: string;
  themeId?: string;
  org?: string;
  user?: string;
  pages: Page[];
}
