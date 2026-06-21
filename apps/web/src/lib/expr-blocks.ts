/**
 * 受限表达式 ⇄ 可视化积木（配置态"搭积木"用，Slice 1 精修）。
 *
 * 单一真相源仍是表达式串（引擎读它）；积木只是编辑视图：加载时把串**解析**成积木，
 * 编辑后把积木**序列化**回串。解析不了（含括号/混合 AND·OR/复杂项）→ ok:false，UI 回退裸文本编辑，
 * 永不丢用户的表达式。纯函数、零依赖。
 */

const isRef = (s: string): boolean => /^[A-Za-z_一-龥][\w一-龥]*$/.test(s.trim());
const OPS = ['>=', '<=', '!=', '==', '>', '<', '=']; // 长的在前，匹配时先命中 >= 再 >

// ── 权重和：M_a * 0.5 + M_b * 0.3 + M_c ⇄ terms ──
export interface WeightTerm { ref: string; weight: number }

export function parseWeightedSum(expr: string): { ok: boolean; terms: WeightTerm[] } {
  if (!expr || !expr.trim() || /[()]/.test(expr)) return { ok: false, terms: [] };
  const parts = expr.split('+').map((s) => s.trim()).filter(Boolean);
  const terms: WeightTerm[] = [];
  for (const p of parts) {
    const m1 = p.match(/^(.+?)\s*\*\s*(-?\d+(?:\.\d+)?)$/); // REF * NUM
    const m2 = p.match(/^(-?\d+(?:\.\d+)?)\s*\*\s*(.+?)$/); // NUM * REF
    if (m1 && isRef(m1[1])) terms.push({ ref: m1[1].trim(), weight: Number(m1[2]) });
    else if (m2 && isRef(m2[2])) terms.push({ ref: m2[2].trim(), weight: Number(m2[1]) });
    else if (isRef(p)) terms.push({ ref: p.trim(), weight: 1 });
    else return { ok: false, terms: [] }; // 复杂项 → 回退文本
  }
  return { ok: terms.length > 0, terms };
}

export function serializeWeightedSum(terms: WeightTerm[]): string {
  return terms.map((t) => `${t.ref} * ${t.weight}`).join(' + ');
}

// ── 条件：F_x >= 50 AND M_y >= 1 ⇄ {join, conds} ──
export interface Cond { left: string; op: string; right: string }

export function parseConditions(when: string): { ok: boolean; join: 'AND' | 'OR'; conds: Cond[] } {
  const fail = { ok: false, join: 'AND' as const, conds: [] };
  if (!when || !when.trim() || /[()]/.test(when)) return fail;
  const hasAnd = /\bAND\b/i.test(when);
  const hasOr = /\bOR\b/i.test(when);
  if (hasAnd && hasOr) return fail; // 混合 AND/OR → 回退（v1 积木只管单一连接）
  const join: 'AND' | 'OR' = hasOr ? 'OR' : 'AND';
  const parts = when.split(new RegExp(`\\b${join}\\b`, 'i')).map((s) => s.trim()).filter(Boolean);
  const conds: Cond[] = [];
  for (const p of parts) {
    const op = OPS.find((o) => p.includes(o));
    if (!op) return fail;
    const idx = p.indexOf(op);
    const left = p.slice(0, idx).trim();
    const right = p.slice(idx + op.length).trim();
    if (!isRef(left) || !right) return fail;
    conds.push({ left, op, right });
  }
  return { ok: conds.length > 0, join, conds };
}

export function serializeConditions(join: 'AND' | 'OR', conds: Cond[]): string {
  return conds.map((c) => `${c.left} ${c.op} ${c.right}`).join(` ${join} `);
}
