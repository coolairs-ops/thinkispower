const mockExec = jest.fn();
jest.mock('node:child_process', () => ({ exec: (cmd: unknown, opts: unknown, cb: unknown) => mockExec(cmd, opts, cb) }));

const writes: Record<string, Buffer> = {};
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(async () => undefined),
  writeFile: jest.fn(async (p: string, data: Buffer) => { writes[p.replace(/\\/g, '/')] = data; }),
}));

import AdmZip from 'adm-zip';
import { RuoyiLocalDeployer, RuoyiDeployConfig } from './ruoyi-local-deployer';

/** exec(cmd, opts, cb) → cb(null,{stdout,stderr})；记录被调命令。 */
function execOk() {
  mockExec.mockImplementation((cmd: string, _opts: unknown, cb: (e: unknown, r: unknown) => void) => {
    cb(null, { stdout: 'BUILD SUCCESS', stderr: '' });
  });
}

function genZip(): Buffer {
  const z = new AdmZip();
  z.addFile('main/java/org/dromara/system/controller/DemoStoreController.java', Buffer.from('class C{}'));
  z.addFile('main/java/org/dromara/system/domain/DemoStore.java', Buffer.from('class D{}'));
  z.addFile('main/resources/mapper/system/DemoStoreMapper.xml', Buffer.from('<xml/>'));
  z.addFile('vue/views/system/store/index.vue', Buffer.from('<template/>')); // 应被跳过
  z.addFile('storeMenu.sql', Buffer.from('insert ...')); // 应被跳过
  return z.toBuffer();
}

const cfg: RuoyiDeployConfig = {
  srcRoot: '/ruoyi',
  module: 'ruoyi-modules/ruoyi-system',
  compileCmd: 'mvn compile -pl ruoyi-modules/ruoyi-system',
  restartCmd: 'docker restart ruoyi-server',
};

describe('RuoyiLocalDeployer（私有化档部署驱动）', () => {
  const ruoyiCfg = { baseUrl: 'http://x', clientId: 'c', username: 'a', password: 'p', tenantId: '0' };

  beforeEach(() => {
    for (const k of Object.keys(writes)) delete writes[k];
    mockExec.mockReset();
    execOk();
  });

  it('只落 main/java、main/resources；vue/菜单sql 跳过；末尾编译+重启', async () => {
    const client = { importAndDownload: jest.fn(async () => genZip()) };
    const d = new RuoyiLocalDeployer(client as never, cfg);
    await d.deployTables(ruoyiCfg, ['demo_store']);

    const paths = Object.keys(writes).sort();
    expect(paths).toEqual([
      '/ruoyi/ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/controller/DemoStoreController.java',
      '/ruoyi/ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/domain/DemoStore.java',
      '/ruoyi/ruoyi-modules/ruoyi-system/src/main/resources/mapper/system/DemoStoreMapper.xml',
    ]);
    expect(paths.some((p) => p.includes('.vue') || p.includes('Menu.sql'))).toBe(false);
    // 内容正确落盘
    expect(writes[paths[0]].toString()).toBe('class C{}');
    // 编译 + 重启各一次，顺序对
    const cmds = mockExec.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual([cfg.compileCmd, cfg.restartCmd]);
  });

  it('多表：每表都 importAndDownload，最后只编译/重启一次', async () => {
    const client = { importAndDownload: jest.fn(async () => genZip()) };
    const d = new RuoyiLocalDeployer(client as never, cfg);
    await d.deployTables(ruoyiCfg, ['demo_store', 'demo_task']);
    expect(client.importAndDownload).toHaveBeenCalledTimes(2);
    expect(mockExec).toHaveBeenCalledTimes(2); // compile + restart 各一次
  });

  it('空表 → 不动文件不编译', async () => {
    const client = { importAndDownload: jest.fn() };
    await new RuoyiLocalDeployer(client as never, cfg).deployTables(ruoyiCfg, []);
    expect(client.importAndDownload).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('编译失败 → 抛错（带命令上下文）', async () => {
    mockExec.mockImplementation((cmd: string, _o: unknown, cb: (e: unknown, r: unknown) => void) => {
      if (cmd.includes('mvn')) cb(new Error('compile error'), null);
      else cb(null, { stdout: '', stderr: '' });
    });
    const client = { importAndDownload: jest.fn(async () => genZip()) };
    await expect(new RuoyiLocalDeployer(client as never, cfg).deployTables(ruoyiCfg, ['demo_store'])).rejects.toThrow('编译失败');
  });

  it('zip 内无后端文件 → 抛错（codegen 异常保护）', async () => {
    const empty = new AdmZip();
    empty.addFile('vue/x.vue', Buffer.from('x'));
    const client = { importAndDownload: jest.fn(async () => empty.toBuffer()) };
    await expect(new RuoyiLocalDeployer(client as never, cfg).deployTables(ruoyiCfg, ['demo_store'])).rejects.toThrow('无 main/java');
  });
});
