import { evaluate, evaluateBool, EvalError } from './rule-expr';

const scope = (vars: Record<string, any>, funcs?: any) => ({ vars, funcs });

describe('rule-expr 受限表达式求值器', () => {
  describe('算术 + 优先级', () => {
    it('加权和按优先级算（* 先于 +）', () => {
      expect(evaluate('M_a * 0.5 + M_b * 0.3', scope({ M_a: 10, M_b: 20 }))).toBe(11);
    });
    it('括号改变优先级', () => {
      expect(evaluate('(M_a + M_b) * 2', scope({ M_a: 3, M_b: 4 }))).toBe(14);
    });
    it('一元负号', () => {
      expect(evaluate('-M_x + 5', scope({ M_x: 3 }))).toBe(2);
    });
    it('除零返 0 不崩', () => {
      expect(evaluate('M_x / 0', scope({ M_x: 5 }))).toBe(0);
    });
  });

  describe('比较 + 逻辑（rule.when / filter）', () => {
    it('数值比较 + AND', () => {
      expect(evaluateBool('F_score >= 80 AND M_fei >= 2', scope({ F_score: 86, M_fei: 3 }))).toBe(true);
      expect(evaluateBool('F_score >= 80 AND M_fei >= 2', scope({ F_score: 86, M_fei: 1 }))).toBe(false);
    });
    it('OR 短语', () => {
      expect(evaluateBool('F_score >= 90 OR M_veto = 1', scope({ F_score: 50, M_veto: 1 }))).toBe(true);
    });
    it('字符串等值（单 = 与 ==，含中文）', () => {
      expect(evaluateBool("检查类型 = '飞检'", scope({ 检查类型: '飞检' }))).toBe(true);
      expect(evaluateBool("检查类型 == '日常'", scope({ 检查类型: '飞检' }))).toBe(false);
    });
    it('ISO 日期按字典序比较（时间窗）', () => {
      expect(evaluateBool("检查日期 >= '2026-03-21'", scope({ 检查日期: '2026-05-10' }))).toBe(true);
      expect(evaluateBool("检查日期 >= '2026-03-21'", scope({ 检查日期: '2026-01-10' }))).toBe(false);
    });
    it('NOT', () => {
      expect(evaluateBool("NOT (类型 = '飞检')", scope({ 类型: '日常' }))).toBe(true);
    });
  });

  describe('白名单函数', () => {
    it('normalize / clamp / min / max', () => {
      expect(evaluate('normalize(M_x, 0, 100)', scope({ M_x: 50 }))).toBe(0.5);
      expect(evaluate('clamp(M_x, 0, 10)', scope({ M_x: 99 }))).toBe(10);
      expect(evaluate('max(M_a, M_b)', scope({ M_a: 3, M_b: 7 }))).toBe(7);
    });
    it('piecewise 分段映射', () => {
      // x<60→1, x<80→2, else 3
      const f = (x: number) => evaluate('piecewise(M_x, 60, 1, 80, 2, 3)', scope({ M_x: x }));
      expect(f(50)).toBe(1);
      expect(f(70)).toBe(2);
      expect(f(90)).toBe(3);
    });
    it('scope 注入函数（如 monthsAgo）', () => {
      expect(evaluateBool("d >= monthsAgo(3)", scope({ d: '2026-05-01' }, { monthsAgo: () => '2026-03-21' }))).toBe(true);
    });
  });

  describe('安全：不注入、不崩、坏输入报 EvalError', () => {
    it('未定义标识符 → EvalError（不静默返 undefined）', () => {
      expect(() => evaluate('M_unknown + 1', scope({}))).toThrow(EvalError);
    });
    it('未授权函数 → EvalError（堵死任意调用）', () => {
      expect(() => evaluate('process.exit(1)', scope({}))).toThrow(EvalError);
      expect(() => evaluate('require("fs")', scope({}))).toThrow(EvalError);
      expect(() => evaluate('constructor("x")', scope({}))).toThrow(EvalError);
    });
    it('未闭合字符串 / 多余内容 → EvalError', () => {
      expect(() => evaluate("a = 'x", scope({ a: 1 }))).toThrow(EvalError);
      expect(() => evaluate('1 2 3', scope({}))).toThrow(EvalError);
    });
  });
});
