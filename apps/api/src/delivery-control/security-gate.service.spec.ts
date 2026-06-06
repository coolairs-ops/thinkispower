import { SecurityGateService } from './security-gate.service';

describe('SecurityGateService.checkFileScope', () => {
  const gate = new SecurityGateService();

  it('全部在 allowed 范围内 → allowed=true，无 violation', () => {
    const r = gate.checkFileScope({
      changedFiles: ['src/customers/customer.service.ts', 'src/auth/jwt.guard.ts'],
      allowedFiles: ['src/customers/**', 'src/auth/**'],
      forbiddenFiles: ['.env', 'node_modules/**'],
    });
    expect(r.allowed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('命中 forbidden → reason=forbidden 且带 pattern', () => {
    const r = gate.checkFileScope({
      changedFiles: ['.env'],
      allowedFiles: ['src/**'],
      forbiddenFiles: ['.env', 'node_modules/**'],
    });
    expect(r.allowed).toBe(false);
    expect(r.violations).toEqual([{ file: '.env', reason: 'forbidden', pattern: '.env' }]);
  });

  it('allowed 非空但文件不在范围内 → reason=out-of-scope', () => {
    const r = gate.checkFileScope({
      changedFiles: ['src/billing/secret.ts'],
      allowedFiles: ['src/customers/**'],
    });
    expect(r.allowed).toBe(false);
    expect(r.violations).toEqual([{ file: 'src/billing/secret.ts', reason: 'out-of-scope' }]);
  });

  it('forbidden 优先于 allowed（同一文件两者都命中时判 forbidden）', () => {
    const r = gate.checkFileScope({
      changedFiles: ['src/config/.env'],
      allowedFiles: ['src/**'],
      forbiddenFiles: ['**/.env'],
    });
    expect(r.violations[0].reason).toBe('forbidden');
  });

  it('** 跨目录匹配', () => {
    const r = gate.checkFileScope({
      changedFiles: ['node_modules/foo/bar/baz.js'],
      forbiddenFiles: ['node_modules/**'],
    });
    expect(r.allowed).toBe(false);
    expect(r.violations[0].reason).toBe('forbidden');
  });

  it('精确路径匹配（prisma/schema.prisma）', () => {
    const r = gate.checkFileScope({
      changedFiles: ['prisma/schema.prisma'],
      allowedFiles: ['prisma/schema.prisma'],
    });
    expect(r.allowed).toBe(true);
  });

  it('allowedFiles 为空 → 不限制范围，只查 forbidden', () => {
    const r = gate.checkFileScope({
      changedFiles: ['anywhere/random/file.ts', 'another.ts'],
      forbiddenFiles: ['.env'],
    });
    expect(r.allowed).toBe(true);
  });

  it('Windows 反斜杠与 ./ 前缀归一化后正常匹配', () => {
    const r = gate.checkFileScope({
      changedFiles: ['.\\src\\customers\\a.ts'],
      allowedFiles: ['src/customers/**'],
    });
    expect(r.allowed).toBe(true);
  });

  it('双星斜杠模式匹配嵌套测试文件', () => {
    const r = gate.checkFileScope({
      changedFiles: ['src/a/b/c.spec.ts'],
      forbiddenFiles: ['**/*.spec.ts'],
    });
    expect(r.violations[0].reason).toBe('forbidden');
  });

  it('* 不跨目录（单段内匹配）', () => {
    const r = gate.checkFileScope({
      changedFiles: ['src/a/b.ts'],
      allowedFiles: ['src/*.ts'],
    });
    expect(r.allowed).toBe(false);
    expect(r.violations[0].reason).toBe('out-of-scope');
  });
});
