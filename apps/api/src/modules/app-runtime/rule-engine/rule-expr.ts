/**
 * 受限表达式求值器（规则引擎核心）。
 *
 * 用于：① formula.expression（算分）② rule.when（条件）③ metric.filter（行过滤）④ assign 结论的 value。
 * 设计铁律（schema 明令"配错最多算错数、不会崩、不会注入"）：
 *   - **绝不用 eval / Function / 任意脚本**——手写 tokenizer + 递归下降 parser + 求值器。
 *   - 标识符只能解析到 scope 提供的变量（metric/formula 值，或行字段）；未知标识符报 EvalError。
 *   - 函数只能是白名单（min/max/abs/round/floor/ceil/clamp/normalize/piecewise + scope 注入的如 monthsAgo）。
 *   - 解析/求值错误抛 EvalError，由引擎 try/catch 降级（标注算错、不崩整条链）。
 *
 * 支持：数字、字符串('...')、标识符(含中文/下划线)、+ - * /、比较 > >= < <= = == != <>、
 *       逻辑 AND OR NOT（亦接受 && || !）、括号、函数调用、一元负号。
 */

export type ExprValue = number | string | boolean | null;

export class EvalError extends Error {}

export interface ExprScope {
  /** 标识符 → 值（metric/formula 值，或行字段值） */
  vars: Record<string, ExprValue>;
  /** 额外函数（如 monthsAgo），与内置白名单合并；同名覆盖内置 */
  funcs?: Record<string, (...args: ExprValue[]) => ExprValue>;
}

// ─── 词法 ───

type TokType = 'num' | 'str' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma';
interface Token { type: TokType; value: string; }

const TWO_CHAR_OPS = ['>=', '<=', '==', '!=', '<>', '&&', '||'];
const ONE_CHAR_OPS = ['+', '-', '*', '/', '>', '<', '=', '!'];
const BREAKERS = new Set([...' \t\n\r', '+', '-', '*', '/', '(', ')', ',', '>', '<', '=', '!', '&', '|', "'"]);

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") j++;
      if (j >= src.length) throw new EvalError(`未闭合的字符串: ${src.slice(i)}`);
      toks.push({ type: 'str', value: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      toks.push({ type: 'num', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '(') { toks.push({ type: 'lparen', value: c }); i++; continue; }
    if (c === ')') { toks.push({ type: 'rparen', value: c }); i++; continue; }
    if (c === ',') { toks.push({ type: 'comma', value: c }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) { toks.push({ type: 'op', value: two }); i += 2; continue; }
    if (ONE_CHAR_OPS.includes(c)) { toks.push({ type: 'op', value: c }); i++; continue; }
    // 标识符：一段非分隔字符（含中文、下划线、字母、数字）
    let j = i;
    while (j < src.length && !BREAKERS.has(src[j])) j++;
    if (j === i) throw new EvalError(`无法识别的字符: ${c}`);
    toks.push({ type: 'ident', value: src.slice(i, j) });
    i = j;
  }
  return toks;
}

// ─── 语法（递归下降，含优先级）───
// or → and (OR and)*
// and → not (AND not)*
// not → (NOT|!) not | cmp
// cmp → add ((>|>=|<|<=|=|==|!=|<>) add)?
// add → mul ((+|-) mul)*
// mul → unary ((*|/) unary)*
// unary → (-) unary | primary
// primary → num | str | ident | ident '(' args ')' | '(' or ')'

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; name: string }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'unary'; op: string; x: Node }
  | { k: 'bin'; op: string; l: Node; r: Node };

class Parser {
  private p = 0;
  constructor(private toks: Token[]) {}
  private peek(): Token | undefined { return this.toks[this.p]; }
  private next(): Token { const t = this.toks[this.p++]; if (!t) throw new EvalError('表达式意外结束'); return t; }
  private isKw(t: Token | undefined, kw: string): boolean { return !!t && t.type === 'ident' && t.value.toUpperCase() === kw; }

  parse(): Node {
    const n = this.parseOr();
    if (this.p !== this.toks.length) throw new EvalError(`表达式有多余内容: ${this.toks.slice(this.p).map(t => t.value).join(' ')}`);
    return n;
  }
  private parseOr(): Node {
    let l = this.parseAnd();
    while (this.peek() && (this.peek()!.value === '||' || this.isKw(this.peek(), 'OR'))) { this.next(); l = { k: 'bin', op: 'OR', l, r: this.parseAnd() }; }
    return l;
  }
  private parseAnd(): Node {
    let l = this.parseNot();
    while (this.peek() && (this.peek()!.value === '&&' || this.isKw(this.peek(), 'AND'))) { this.next(); l = { k: 'bin', op: 'AND', l, r: this.parseNot() }; }
    return l;
  }
  private parseNot(): Node {
    if (this.peek() && (this.peek()!.value === '!' || this.isKw(this.peek(), 'NOT'))) { this.next(); return { k: 'unary', op: 'NOT', x: this.parseNot() }; }
    return this.parseCmp();
  }
  private parseCmp(): Node {
    let l = this.parseAdd();
    const t = this.peek();
    if (t && t.type === 'op' && ['>', '>=', '<', '<=', '=', '==', '!=', '<>'].includes(t.value)) {
      this.next();
      l = { k: 'bin', op: t.value, l, r: this.parseAdd() };
    }
    return l;
  }
  private parseAdd(): Node {
    let l = this.parseMul();
    while (this.peek() && (this.peek()!.value === '+' || this.peek()!.value === '-')) { const op = this.next().value; l = { k: 'bin', op, l, r: this.parseMul() }; }
    return l;
  }
  private parseMul(): Node {
    let l = this.parseUnary();
    while (this.peek() && (this.peek()!.value === '*' || this.peek()!.value === '/')) { const op = this.next().value; l = { k: 'bin', op, l, r: this.parseUnary() }; }
    return l;
  }
  private parseUnary(): Node {
    if (this.peek() && this.peek()!.value === '-') { this.next(); return { k: 'unary', op: '-', x: this.parseUnary() }; }
    return this.parsePrimary();
  }
  private parsePrimary(): Node {
    const t = this.next();
    if (t.type === 'num') return { k: 'num', v: Number(t.value) };
    if (t.type === 'str') return { k: 'str', v: t.value };
    if (t.type === 'lparen') { const n = this.parseOr(); const r = this.next(); if (r.type !== 'rparen') throw new EvalError('缺少右括号'); return n; }
    if (t.type === 'ident') {
      if (this.peek() && this.peek()!.type === 'lparen') {
        this.next(); // (
        const args: Node[] = [];
        if (this.peek() && this.peek()!.type !== 'rparen') {
          args.push(this.parseOr());
          while (this.peek() && this.peek()!.type === 'comma') { this.next(); args.push(this.parseOr()); }
        }
        const r = this.next();
        if (r.type !== 'rparen') throw new EvalError('函数调用缺少右括号');
        return { k: 'call', name: t.value, args };
      }
      return { k: 'var', name: t.value };
    }
    throw new EvalError(`非法表达式片段: ${t.value}`);
  }
}

// ─── 求值 ───

const BUILTINS: Record<string, (...a: ExprValue[]) => ExprValue> = {
  min: (...a) => Math.min(...a.map(num)),
  max: (...a) => Math.max(...a.map(num)),
  abs: (x) => Math.abs(num(x)),
  round: (x) => Math.round(num(x)),
  floor: (x) => Math.floor(num(x)),
  ceil: (x) => Math.ceil(num(x)),
  clamp: (x, lo, hi) => Math.min(Math.max(num(x), num(lo)), num(hi)),
  normalize: (x, lo, hi) => { const d = num(hi) - num(lo); return d === 0 ? 0 : Math.min(Math.max((num(x) - num(lo)) / d, 0), 1); },
  // piecewise(x, t1,v1, t2,v2, ..., elseV)：返回首个 x < tK 的 vK，皆不满足则 elseV（参数个数须为偶数）
  piecewise: (x, ...rest) => {
    const xv = num(x);
    for (let i = 0; i + 1 < rest.length; i += 2) { if (xv < num(rest[i])) return rest[i + 1]; }
    return rest.length % 2 === 1 ? rest[rest.length - 1] : null;
  },
};

function num(v: ExprValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  throw new EvalError(`期望数字，得到: ${JSON.stringify(v)}`);
}

function truthy(v: ExprValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null) return false;
  return String(v).length > 0;
}

function compare(op: string, l: ExprValue, r: ExprValue): boolean {
  const bothNum = (typeof l === 'number' || (typeof l === 'string' && l !== '' && !isNaN(Number(l)))) &&
                  (typeof r === 'number' || (typeof r === 'string' && r !== '' && !isNaN(Number(r))));
  if (op === '=' || op === '==') return bothNum ? num(l) === num(r) : String(l) === String(r);
  if (op === '!=' || op === '<>') return bothNum ? num(l) !== num(r) : String(l) !== String(r);
  // 大小比较：数字按数值，否则按字符串字典序（ISO 日期可直接比）
  const [a, b]: [number | string, number | string] = bothNum ? [num(l), num(r)] : [String(l), String(r)];
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
  }
  throw new EvalError(`未知比较符: ${op}`);
}

function evalNode(n: Node, scope: ExprScope): ExprValue {
  switch (n.k) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'var': {
      if (!(n.name in scope.vars)) throw new EvalError(`未定义的标识符: ${n.name}`);
      return scope.vars[n.name];
    }
    case 'call': {
      const fn = scope.funcs?.[n.name] ?? BUILTINS[n.name];
      if (!fn) throw new EvalError(`未授权的函数: ${n.name}`);
      return fn(...n.args.map((a) => evalNode(a, scope)));
    }
    case 'unary':
      if (n.op === 'NOT') return !truthy(evalNode(n.x, scope));
      return -num(evalNode(n.x, scope)); // 一元负
    case 'bin': {
      if (n.op === 'AND') return truthy(evalNode(n.l, scope)) && truthy(evalNode(n.r, scope));
      if (n.op === 'OR') return truthy(evalNode(n.l, scope)) || truthy(evalNode(n.r, scope));
      const l = evalNode(n.l, scope);
      const r = evalNode(n.r, scope);
      if (['>', '>=', '<', '<=', '=', '==', '!=', '<>'].includes(n.op)) return compare(n.op, l, r);
      const a = num(l), b = num(r);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? 0 : a / b; // 除零返 0，不崩
      }
      throw new EvalError(`未知运算符: ${n.op}`);
    }
  }
}

/** 求一个受限表达式的值。解析/求值错误抛 EvalError（由调用方降级处理）。 */
export function evaluate(expr: string, scope: ExprScope): ExprValue {
  const toks = tokenize(expr);
  if (toks.length === 0) throw new EvalError('空表达式');
  const ast = new Parser(toks).parse();
  return evalNode(ast, scope);
}

/** 便捷：把表达式当布尔条件求值（rule.when / metric.filter）。 */
export function evaluateBool(expr: string, scope: ExprScope): boolean {
  return truthy(evaluate(expr, scope));
}
