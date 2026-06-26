const mockExec = jest.fn();
jest.mock('node:child_process', () => ({ exec: (cmd: unknown, opts: unknown, cb: unknown) => mockExec(cmd, opts, cb) }));

const writes: Record<string, Buffer> = {};
const removed: string[] = [];
const mockReaddir = jest.fn(async (..._a: unknown[]): Promise<string[]> => { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; });
const mockReadFile = jest.fn(async (..._a: unknown[]): Promise<string> => '');
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(async () => undefined),
  writeFile: jest.fn(async (p: string, data: Buffer) => { writes[p.replace(/\\/g, '/')] = data; }),
  readdir: (...a: unknown[]) => mockReaddir(...(a as [])),
  readFile: (...a: unknown[]) => mockReadFile(...(a as [])),
  rm: jest.fn(async (p: string) => { removed.push(p.replace(/\\/g, '/')); }),
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
    removed.length = 0;
    mockReaddir.mockReset();
    mockReaddir.mockImplementation(async () => { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; });
    mockReadFile.mockReset();
    mockReadFile.mockResolvedValue('');
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

  it('Mapper.java 落盘时注入 @DataPermission（坎2 数据权限）', async () => {
    const z = new AdmZip();
    z.addFile(
      'main/java/org/dromara/system/mapper/CustomerMapper.java',
      Buffer.from('package org.dromara.system.mapper;\nimport org.dromara.common.mybatis.core.mapper.BaseMapperPlus;\npublic interface CustomerMapper extends BaseMapperPlus<Customer, CustomerVo> {\n}\n'),
    );
    const client = { importAndDownload: jest.fn(async () => z.toBuffer()) };
    await new RuoyiLocalDeployer(client as never, cfg).deployTables(ruoyiCfg, ['customer']);
    const mapperPath = '/ruoyi/ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/mapper/CustomerMapper.java';
    expect(writes[mapperPath].toString()).toContain('@DataPermission');
    expect(writes[mapperPath].toString()).toContain('value = "create_by"');
  });

  it('deploySources：编译+重启但不探活（断点续跑边界）', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const client = { importAndDownload: jest.fn(async () => genZip()) };
    const d = new RuoyiLocalDeployer(client as never, { ...cfg, readyUrl: 'http://ruoyi:8080' });
    await d.deploySources(ruoyiCfg, ['demo_store']);
    const cmds = mockExec.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual([cfg.compileCmd, cfg.restartCmd]); // 编译+重启
    expect(fetchSpy).not.toHaveBeenCalled(); // 不探活——waitReady 由 provisionApp 单独调
    fetchSpy.mockRestore();
  });

  describe('撞 @RequestMapping 旧生成物清理（跨次置备 businessName 重名防崩库）', () => {
    // 本次表 store → StoreController，@RequestMapping("/system/store")。
    function genZipStore(): Buffer {
      const z = new AdmZip();
      z.addFile('main/java/org/dromara/system/controller/StoreController.java', Buffer.from('@RestController\n@RequestMapping("/system/store")\npublic class StoreController {}'));
      z.addFile('main/java/org/dromara/system/domain/Store.java', Buffer.from('class S{}'));
      z.addFile('main/resources/mapper/system/StoreMapper.xml', Buffer.from('<xml/>'));
      return z.toBuffer();
    }
    const base = '/ruoyi/ruoyi-modules/ruoyi-system';

    it('旧 DemoStore* 与本次 Store 同 mapping → 删旧全家(java七件+xml)及对应 .class，新文件照写', async () => {
      mockReaddir.mockResolvedValueOnce(['DemoStoreController.java', 'StoreController.java', 'OtherController.java']);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const f = String(p).replace(/\\/g, '/');
        if (f.endsWith('DemoStoreController.java')) return '@RequestMapping("/system/store")'; // 撞车
        if (f.endsWith('OtherController.java')) return '@RequestMapping("/system/other")'; // 不撞
        return '';
      });
      const client = { importAndDownload: jest.fn(async () => genZipStore()) };
      await new RuoyiLocalDeployer(client as never, cfg).deployTables(ruoyiCfg, ['store']);

      // 旧 DemoStore 全家 java（含 service/impl）+ mapper.xml 被删
      for (const rel of [
        'src/main/java/org/dromara/system/controller/DemoStoreController.java',
        'src/main/java/org/dromara/system/domain/DemoStore.java',
        'src/main/java/org/dromara/system/domain/bo/DemoStoreBo.java',
        'src/main/java/org/dromara/system/domain/vo/DemoStoreVo.java',
        'src/main/java/org/dromara/system/service/IDemoStoreService.java',
        'src/main/java/org/dromara/system/service/impl/DemoStoreServiceImpl.java',
        'src/main/java/org/dromara/system/mapper/DemoStoreMapper.java',
        'src/main/resources/mapper/system/DemoStoreMapper.xml',
      ]) expect(removed).toContain(`${base}/${rel}`);
      // 对应 target/classes 的编译产物被精准删（否则 boot 仍 cp 旧 class）
      expect(removed).toContain(`${base}/target/classes/org/dromara/system/controller/DemoStoreController.class`);
      expect(removed).toContain(`${base}/target/classes/org/dromara/system/service/impl/DemoStoreServiceImpl.class`);
      expect(removed).toContain(`${base}/target/classes/mapper/system/DemoStoreMapper.xml`);
      // 不撞的 OtherController 全家不动
      expect(removed.some((p) => p.includes('Other'))).toBe(false);
      // 新 Store 后端文件照常落盘
      expect(Object.keys(writes)).toContain(`${base}/src/main/java/org/dromara/system/controller/StoreController.java`);
    });

    it('controller 目录尚不存在（首次置备）→ 不删任何东西，照写', async () => {
      // mockReaddir 默认抛 ENOENT
      const client = { importAndDownload: jest.fn(async () => genZipStore()) };
      await new RuoyiLocalDeployer(client as never, cfg).deployTables(ruoyiCfg, ['store']);
      expect(removed).toHaveLength(0);
      expect(Object.keys(writes)).toContain(`${base}/src/main/java/org/dromara/system/controller/StoreController.java`);
    });

    it('zip 内 Controller 无 @RequestMapping（旧测试桩）→ 不扫不删（不敢乱删）', async () => {
      const client = { importAndDownload: jest.fn(async () => genZip()) }; // controller 内容是 'class C{}'
      await new RuoyiLocalDeployer(client as never, cfg).deployTables(ruoyiCfg, ['demo_store']);
      expect(mockReaddir).not.toHaveBeenCalled();
      expect(removed).toHaveLength(0);
    });
  });

  describe('waitReady（探活硬化）', () => {
    const readyCfg: RuoyiDeployConfig = { ...cfg, readyUrl: 'http://ruoyi:8080', readyTimeoutMs: 30_000 };
    let fetchSpy: jest.SpyInstance | undefined;

    afterEach(() => {
      jest.useRealTimers();
      fetchSpy?.mockRestore();
      fetchSpy = undefined;
    });

    it('收到非 5xx 即就绪，立即返回（不再等端口）', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response);
      const client = { importAndDownload: jest.fn(async () => genZip()) };
      await new RuoyiLocalDeployer(client as never, readyCfg).deployTables(ruoyiCfg, ['demo_store']);
      expect(fetchSpy).toHaveBeenCalledTimes(1); // 首探即就绪
    });

    it('boot 期 5xx 不算就绪，等到非 5xx 才返回', async () => {
      jest.useFakeTimers();
      const statuses = [503, 502, 200];
      let i = 0;
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => ({ status: statuses[Math.min(i++, statuses.length - 1)] }) as Response);
      const client = { importAndDownload: jest.fn(async () => genZip()) };
      const p = new RuoyiLocalDeployer(client as never, readyCfg).deployTables(ruoyiCfg, ['demo_store']);
      await jest.advanceTimersByTimeAsync(25_000); // 两次 503/502 + 各 10s 退避 + 第三次 200
      await p;
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('连接被拒（fetch 抛）也继续等，不误判就绪', async () => {
      jest.useFakeTimers();
      let i = 0;
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
        if (i++ === 0) throw new Error('ECONNREFUSED');
        return { status: 404 } as Response; // 404=DispatcherServlet 在响应=已就绪
      });
      const client = { importAndDownload: jest.fn(async () => genZip()) };
      const p = new RuoyiLocalDeployer(client as never, readyCfg).deployTables(ruoyiCfg, ['demo_store']);
      await jest.advanceTimersByTimeAsync(15_000);
      await p;
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('始终 5xx → 超时抛错（带次数上下文）', async () => {
      jest.useFakeTimers();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 503 } as Response);
      const client = { importAndDownload: jest.fn(async () => genZip()) };
      const p = new RuoyiLocalDeployer(client as never, readyCfg).deployTables(ruoyiCfg, ['demo_store']);
      const assertion = expect(p).rejects.toThrow('探活超时');
      await jest.advanceTimersByTimeAsync(35_000);
      await assertion;
    });
  });
});
