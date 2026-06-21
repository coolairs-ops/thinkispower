/**
 * 内置主题皮肤 token（模板库柱石）。
 *
 * 用户拍板：平台生成的前端不再让 DeepSeek 即兴出 HTML，改"选主题 + 套页型 + 填数据"。
 * 6 套政企皮肤抽成 token 组，换皮 = 换一组值；页型/外壳只读 var(--t-*)，与具体皮肤解耦。
 * 纯数据、零依赖、确定性。
 */
export type ThemeId = 'gov-blue' | 'gov-red' | 'dark-ops' | 'biz-teal' | 'minimal' | 'tech-purple';

export interface ThemeTokens {
  id: ThemeId;
  name: string;
  dark: boolean;
  headerBg: string;
  headerText: string;
  headerSub: string;
  navActiveBg: string;
  navActiveText: string;
  navText: string;
  navBg: string;
  surface: string; // 页面底
  card: string; // 卡片底
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  primary: string; // 主操作色（按钮）
  primaryText: string;
}

/** 语义色（风险/状态），各皮肤共用，保证 D红/C黄/B蓝/A绿 一致认知。 */
export const SEMANTIC = {
  dangerBg: '#FCEBEB', dangerText: '#791F1F',
  warningBg: '#FAEEDA', warningText: '#633806',
  infoBg: '#E6F1FB', infoText: '#0C447C',
  successBg: '#EAF3DE', successText: '#27500A',
};
/** 深色皮肤下的语义底色（深底浅字）。 */
export const SEMANTIC_DARK = {
  dangerBg: '#501313', dangerText: '#F7C1C1',
  warningBg: '#633806', warningText: '#FAC775',
  infoBg: '#0C447C', infoText: '#B5D4F4',
  successBg: '#27500A', successText: '#C0DD97',
};

export const THEMES: Record<ThemeId, ThemeTokens> = {
  'gov-blue': {
    id: 'gov-blue', name: '政务蓝', dark: false,
    headerBg: '#185FA5', headerText: '#ffffff', headerSub: '#B5D4F4',
    navActiveBg: '#E6F1FB', navActiveText: '#0C447C', navText: '#5F5E5A', navBg: '#F7F8FA',
    surface: '#F1F3F6', card: '#ffffff', cardBorder: 'rgba(0,0,0,0.10)',
    textPrimary: '#1c2430', textSecondary: '#5F5E5A', textTertiary: '#9a9a93',
    primary: '#185FA5', primaryText: '#ffffff',
  },
  'gov-red': {
    id: 'gov-red', name: '党政红', dark: false,
    headerBg: '#A32D2D', headerText: '#ffffff', headerSub: '#F7C1C1',
    navActiveBg: '#FCEBEB', navActiveText: '#791F1F', navText: '#5F5E5A', navBg: '#F8F7F6',
    surface: '#F2F0EF', card: '#ffffff', cardBorder: 'rgba(0,0,0,0.10)',
    textPrimary: '#2a2422', textSecondary: '#5F5E5A', textTertiary: '#9a9a93',
    primary: '#A32D2D', primaryText: '#ffffff',
  },
  'dark-ops': {
    id: 'dark-ops', name: '深色指挥大屏', dark: true,
    headerBg: '#021d38', headerText: '#B5D4F4', headerSub: '#5DCAA5',
    navActiveBg: '#0C447C', navActiveText: '#B5D4F4', navText: '#85B7EB', navBg: '#042C53',
    surface: '#021526', card: '#042C53', cardBorder: 'rgba(133,183,235,0.18)',
    textPrimary: '#e8f1fb', textSecondary: '#85B7EB', textTertiary: '#5a7da0',
    primary: '#185FA5', primaryText: '#ffffff',
  },
  'biz-teal': {
    id: 'biz-teal', name: '商务墨绿', dark: false,
    headerBg: '#0F6E56', headerText: '#ffffff', headerSub: '#9FE1CB',
    navActiveBg: '#E1F5EE', navActiveText: '#085041', navText: '#5F5E5A', navBg: '#F6F8F7',
    surface: '#EEF2F0', card: '#ffffff', cardBorder: 'rgba(0,0,0,0.10)',
    textPrimary: '#1f2a26', textSecondary: '#5F5E5A', textTertiary: '#9a9a93',
    primary: '#0F6E56', primaryText: '#ffffff',
  },
  'minimal': {
    id: 'minimal', name: '简约企业白', dark: false,
    headerBg: '#ffffff', headerText: '#1c2430', headerSub: '#888780',
    navActiveBg: '#F1EFE8', navActiveText: '#1c2430', navText: '#5F5E5A', navBg: '#ffffff',
    surface: '#F7F7F5', card: '#ffffff', cardBorder: 'rgba(0,0,0,0.10)',
    textPrimary: '#1c2430', textSecondary: '#5F5E5A', textTertiary: '#9a9a93',
    primary: '#185FA5', primaryText: '#ffffff',
  },
  'tech-purple': {
    id: 'tech-purple', name: '科技紫蓝', dark: false,
    headerBg: '#3C3489', headerText: '#ffffff', headerSub: '#CECBF6',
    navActiveBg: '#EEEDFE', navActiveText: '#3C3489', navText: '#5F5E5A', navBg: '#F8F7FB',
    surface: '#F1F0F6', card: '#ffffff', cardBorder: 'rgba(0,0,0,0.10)',
    textPrimary: '#221f33', textSecondary: '#5F5E5A', textTertiary: '#9a9a93',
    primary: '#534AB7', primaryText: '#ffffff',
  },
};

export function getTheme(id: string | undefined): ThemeTokens {
  return THEMES[(id as ThemeId)] ?? THEMES['gov-blue'];
}

/** 主题 token → CSS 变量声明块（注入 <style>，页型/外壳只读这些 var）。 */
export function themeCssVars(theme: ThemeTokens): string {
  const sem = theme.dark ? SEMANTIC_DARK : SEMANTIC;
  const v: Record<string, string> = {
    '--t-header-bg': theme.headerBg, '--t-header-text': theme.headerText, '--t-header-sub': theme.headerSub,
    '--t-nav-active-bg': theme.navActiveBg, '--t-nav-active-text': theme.navActiveText, '--t-nav-text': theme.navText, '--t-nav-bg': theme.navBg,
    '--t-surface': theme.surface, '--t-card': theme.card, '--t-card-border': theme.cardBorder,
    '--t-text': theme.textPrimary, '--t-text-2': theme.textSecondary, '--t-text-3': theme.textTertiary,
    '--t-primary': theme.primary, '--t-primary-text': theme.primaryText,
    '--t-danger-bg': sem.dangerBg, '--t-danger-text': sem.dangerText,
    '--t-warning-bg': sem.warningBg, '--t-warning-text': sem.warningText,
    '--t-info-bg': sem.infoBg, '--t-info-text': sem.infoText,
    '--t-success-bg': sem.successBg, '--t-success-text': sem.successText,
  };
  return Object.entries(v).map(([k, val]) => `${k}:${val}`).join(';');
}

/** 模板库元数据（选皮肤 UI 用）。 */
export function listThemes() {
  return Object.values(THEMES).map((t) => ({ id: t.id, name: t.name, dark: t.dark, primary: t.primary }));
}
