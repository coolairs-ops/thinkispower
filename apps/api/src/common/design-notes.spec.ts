import { adoptedDesignNotes } from './design-notes';

describe('adoptedDesignNotes（已采纳设计建议 → 生成约束）', () => {
  it('只取 adopted=true 的文字类建议，按类别成行', () => {
    const sr = {
      designSuggestions: [
        { category: 'navigation', title: '底部标签导航', description: '三主入口', adopted: true },
        { category: 'layout', title: '卡片布局', description: '网格卡片', adopted: false },
        { category: 'flow', title: '三级跳转', description: '列表→详情→项目', adopted: true },
      ],
    };
    const notes = adoptedDesignNotes(sr);
    expect(notes).toContain('导航结构｜底部标签导航：三主入口');
    expect(notes).toContain('操作流程｜三级跳转：列表→详情→项目');
    expect(notes).not.toContain('卡片布局'); // 未采纳
  });

  it('配色(color)不注入（走主题，不在文字约束里）', () => {
    const sr = { designSuggestions: [{ category: 'color', title: '配色方案1', description: '主色#fff', adopted: true }] };
    expect(adoptedDesignNotes(sr)).toBe('');
  });

  it('无采纳项 → 空串', () => {
    const sr = { designSuggestions: [{ category: 'navigation', title: 'x', description: 'y', adopted: false }] };
    expect(adoptedDesignNotes(sr)).toBe('');
  });

  it('无 designSuggestions / 非数组 / null → 空串，不崩', () => {
    expect(adoptedDesignNotes(null)).toBe('');
    expect(adoptedDesignNotes({})).toBe('');
    expect(adoptedDesignNotes({ designSuggestions: 'oops' })).toBe('');
  });

  it('按类别固定顺序（导航→布局→字段→流程）', () => {
    const sr = {
      designSuggestions: [
        { category: 'flow', title: 'F', description: 'f', adopted: true },
        { category: 'navigation', title: 'N', description: 'n', adopted: true },
      ],
    };
    const notes = adoptedDesignNotes(sr);
    expect(notes.indexOf('导航结构')).toBeLessThan(notes.indexOf('操作流程'));
  });
});
