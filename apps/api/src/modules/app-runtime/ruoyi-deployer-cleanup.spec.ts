import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { RuoyiLocalDeployer } from './ruoyi-local-deployer';

/**
 * 用真 deployer + 临时目录 + mock client 验 ADR-0012 ①③：置备前按"每项目生成清单"清掉上次生成物
 * （源文件 + 对应 .class），防 businessName 重名旧文件残留致 Spring Ambiguous mapping（2026-06-26 以岭实测）。
 * 注意：本文件用真 fs（不像 ruoyi-local-deployer.spec.ts 那样 mock fs），故单独成文。
 */
function zipWith(files: Record<string, string>): Buffer {
  const z = new AdmZip();
  for (const [name, content] of Object.entries(files)) z.addFile(name, Buffer.from(content, 'utf8'));
  return z.toBuffer();
}

describe('RuoyiLocalDeployer 置备前清理(ADR-0012 ①③，防 businessName 重名撞)', () => {
  let root: string;
  const cfg = (r: string) => ({ srcRoot: r, module: 'ruoyi-system', compileCmd: 'node -e 0', restartCmd: 'node -e 0' });
  const ctrlDir = (r: string, sub: 'java' | 'classes') =>
    sub === 'java'
      ? join(r, 'ruoyi-system', 'src', 'main', 'java', 'org', 'dromara', 'system', 'controller')
      : join(r, 'ruoyi-system', 'target', 'classes', 'org', 'dromara', 'system', 'controller');

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ruoyi-dep-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('第二次置备删掉第一次生成的源文件 + 对应 .class(含内部类)，新文件保留', async () => {
    const client = { importAndDownload: jest.fn() } as unknown as { importAndDownload: jest.Mock };
    const dep = new RuoyiLocalDeployer(client as never, cfg(root) as never);

    // 第一次：生成 OldController（模拟旧 businessName 的产物）
    client.importAndDownload.mockResolvedValueOnce(zipWith({ 'main/java/org/dromara/system/controller/OldController.java': 'class Old{}' }));
    await dep.deploySources({} as never, ['old'], undefined, 'projX');
    expect(existsSync(join(ctrlDir(root, 'java'), 'OldController.java'))).toBe(true);
    // 模拟编译产物（.class + 内部类）
    await mkdir(ctrlDir(root, 'classes'), { recursive: true });
    await writeFile(join(ctrlDir(root, 'classes'), 'OldController.class'), 'x');
    await writeFile(join(ctrlDir(root, 'classes'), 'OldController$Inner.class'), 'x');

    // 第二次：同项目改生成 NewController —— 应先按清单清掉 Old*(源 + class)
    client.importAndDownload.mockResolvedValueOnce(zipWith({ 'main/java/org/dromara/system/controller/NewController.java': 'class New{}' }));
    await dep.deploySources({} as never, ['new'], undefined, 'projX');

    expect(existsSync(join(ctrlDir(root, 'java'), 'OldController.java'))).toBe(false); // ① 旧源删了
    expect(existsSync(join(ctrlDir(root, 'classes'), 'OldController.class'))).toBe(false); // ③ 旧 class 删了
    expect(existsSync(join(ctrlDir(root, 'classes'), 'OldController$Inner.class'))).toBe(false); // 内部类也删
    expect(existsSync(join(ctrlDir(root, 'java'), 'NewController.java'))).toBe(true); // 新文件在
  });

  it('无清单(首次置备/老实例) → 不清理也不报错', async () => {
    const client = { importAndDownload: jest.fn().mockResolvedValue(zipWith({ 'main/java/org/dromara/system/domain/A.java': 'a' })) } as unknown as { importAndDownload: jest.Mock };
    const dep = new RuoyiLocalDeployer(client as never, cfg(root) as never);
    await expect(dep.deploySources({} as never, ['t'], undefined, 'fresh')).resolves.toBeUndefined();
  });

  it('不同项目互不干扰(清单按 projectId 隔离)', async () => {
    const client = { importAndDownload: jest.fn() } as unknown as { importAndDownload: jest.Mock };
    const dep = new RuoyiLocalDeployer(client as never, cfg(root) as never);
    client.importAndDownload.mockResolvedValue(zipWith({ 'main/java/org/dromara/system/controller/AController.java': 'a' }));
    await dep.deploySources({} as never, ['a'], undefined, 'projA');
    client.importAndDownload.mockResolvedValue(zipWith({ 'main/java/org/dromara/system/controller/BController.java': 'b' }));
    await dep.deploySources({} as never, ['b'], undefined, 'projB');
    expect(existsSync(join(ctrlDir(root, 'java'), 'AController.java'))).toBe(true); // projB 没删 projA 的
    expect(existsSync(join(ctrlDir(root, 'java'), 'BController.java'))).toBe(true);
  });
});
