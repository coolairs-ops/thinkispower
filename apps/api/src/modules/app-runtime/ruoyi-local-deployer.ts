import { Logger } from '@nestjs/common';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, posix, sep } from 'node:path';
import AdmZip from 'adm-zip';
import { RuoyiClient, RuoyiClientConfig } from './ruoyi-client.service';
import { injectDataPermission } from './ruoyi-data-permission';
import type { ConsoleLabels } from './ruoyi-label-gen';

const execAsync = promisify(exec);

/**
 * 若依本地部署驱动（provision 链 ② 的真实现，**私有化档**）。
 *
 * RuoyiRuntime.provisionApp 的 `infra.deployTables` 落点。对每个表：
 *   importTable + 下载 codegen zip（含正确若依工程相对路径）→ 解压把后端文件写进若依模块源码：
 *     zip 内 `main/java/**`     → `<module>/src/main/java/**`
 *     zip 内 `main/resources/**` → `<module>/src/main/resources/**`
 *   （`vue/**` 前端、`*.sql` 菜单本驱动不落——后端 CRUD 端点不依赖；菜单/前端属后续。）
 * 全部写完后 **一次**编译该模块 + 重启实例（exploded 下 = 单模块 mvn compile + 重启，无需 6min repackage）。
 *
 * 部署机制（编译/重启命令）走 config，不写死——私有化档用 docker，换 k8s/systemd 只改命令。
 * 这是私有化档（一客户一实例、重启不影响他人）的实现；SaaS 多租户单实例"不重启加 CRUD"另案。
 */
export interface RuoyiDeployConfig {
  /** 若依工程根（含 ruoyi-modules 等），如 D:\ruoyi-study */
  srcRoot: string;
  /** codegen 后端文件落进的模块（相对 srcRoot），如 ruoyi-modules/ruoyi-system */
  module: string;
  /** 编译该模块的 shell 命令（私有化档：maven 容器单模块 compile） */
  compileCmd: string;
  /** 重启实例的 shell 命令（私有化档：docker restart ruoyi-server） */
  restartCmd: string;
  /** 重启后探活的 URL（收到非 5xx 响应才认为起来了）。设了才等——保证"部署完成=真能服务"。 */
  readyUrl?: string;
  /** 探活超时（ms，默认 30min，覆盖 exploded 冷启 11~22min[历史到 37min]）。 */
  readyTimeoutMs?: number;
  /**
   * 若依前端工程根（plus-ui），如 D:\plus-ui。设了才把 codegen 的 `vue/**` 落进 `{uiRoot}/src/**`——
   * 让生成的实体成为若依控制台真页面（ADR-0012 ②）。未设则只落后端、不落前端（旧行为）。
   * dev 下 vite HMR 自动生效；正式交付需重新构建 plus-ui。
   */
  uiRoot?: string;
}

export class RuoyiLocalDeployer {
  private readonly logger = new Logger(RuoyiLocalDeployer.name);

  constructor(
    private readonly client: RuoyiClient,
    private readonly cfg: RuoyiDeployConfig,
  ) {}

  /**
   * 部署源码并重启，**不等就绪**：每表 importTable+下载→写工程→一次编译→重启。
   * 探活拆出（waitReady），让 provisionApp 在"编译重启完成"与"探活就绪"间打断点——
   * 探活超时重跑只需再 waitReady，不必重编译（编译/冷启是最贵的一段）。
   */
  async deploySources(ruoyiCfg: RuoyiClientConfig, tables: string[], labels?: ConsoleLabels): Promise<void> {
    if (!tables.length) return;
    let written = 0;
    for (const table of tables) {
      const zip = await this.client.importAndDownload(ruoyiCfg, table, labels?.[table]);
      written += await this.writeBackendFiles(zip, table);
    }
    this.logger.log(`部署：${tables.length} 表 / ${written} 个后端文件落盘 → 编译 ${this.cfg.module}`);
    await this.run(this.cfg.compileCmd, '编译');
    await this.run(this.cfg.restartCmd, '重启');
  }

  /** 部署源码→重启→探活就绪（便捷整合，脚本/单测用）。provisionApp 用拆开的 deploySources+waitReady 以支持断点续跑。 */
  async deployTables(ruoyiCfg: RuoyiClientConfig, tables: string[]): Promise<void> {
    if (!tables.length) return;
    await this.deploySources(ruoyiCfg, tables);
    await this.waitReady();
    this.logger.log(`部署完成：${tables.join(',')} 已编译并重启生效`);
  }

  /**
   * 重启后探活：轮询 readyUrl 直到实例**真在服务**（exploded 冷启慢，最长 readyTimeoutMs）。未配 readyUrl 则不等。
   * 判据是"收到非 5xx 响应"，不是"连上就算"——boot 期 Tomcat/反代会先回 502/503 错误页，
   * 把那当就绪会让后续 seedRoles 在实例没起来时 login 失败（曾因探活早于冷启致整条 provision 中断）。
   */
  async waitReady(): Promise<void> {
    const url = this.cfg.readyUrl;
    if (!url) return;
    const timeoutMs = this.cfg.readyTimeoutMs ?? 30 * 60 * 1000;
    const start = Date.now();
    const deadline = start + timeoutMs;
    let attempt = 0;
    let lastLog = start;
    while (Date.now() < deadline) {
      attempt++;
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res.status < 500) {
          const secs = Math.round((Date.now() - start) / 1000);
          this.logger.log(`实例已就绪（探活 ${url} HTTP ${res.status}，第 ${attempt} 次 / ${secs}s）`);
          return;
        }
        // 5xx：boot 期错误页，未就绪——继续等
      } catch {
        // 连接被拒：实例还没起——继续等
      }
      const now = Date.now();
      if (now - lastLog >= 60_000) {
        this.logger.log(`等待实例就绪…已 ${Math.round((now - start) / 1000)}s（探活 ${attempt} 次，上限 ${Math.round(timeoutMs / 1000)}s）`);
        lastLog = now;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    throw new Error(`重启后探活超时：${url} 在 ${Math.round(timeoutMs / 1000)}s 内未返回非 5xx 响应（探活 ${attempt} 次）`);
  }

  /** 解压 zip，把 main/java、main/resources 下文件写进模块源码。返回写入文件数。 */
  private async writeBackendFiles(zipBuf: Buffer, table: string): Promise<number> {
    const moduleSrc = join(this.cfg.srcRoot, this.cfg.module, 'src');
    const entries = new AdmZip(zipBuf).getEntries();
    // 写新文件前先清掉与本次 @RequestMapping 撞车的旧生成物（不同次置备 businessName 重名时，
    // 旧 *Controller.java + .class 与新文件同存一个模块会让 Spring "Ambiguous mapping" 崩库）。
    await this.cleanupCollidingMappings(entries, moduleSrc, table);
    let n = 0;
    let vueN = 0;
    for (const e of entries) {
      if (e.isDirectory) continue;
      const name = e.entryName.replace(/\\/g, '/'); // 统一正斜杠
      // 前端 vue 落 plus-ui（ADR-0012 ②：让实体成为若依控制台真页面）。zip `vue/**` → `{uiRoot}/src/**`
      if (name.startsWith('vue/') && this.cfg.uiRoot) {
        const vt = join(this.cfg.uiRoot, 'src', ...name.slice('vue/'.length).split('/'));
        await mkdir(dirname(vt), { recursive: true });
        await writeFile(vt, e.getData());
        vueN++;
        continue;
      }
      const target = this.targetPath(name, moduleSrc);
      if (!target) continue; // 菜单 sql、未配 uiRoot 的 vue 等：本驱动不落
      await mkdir(dirname(target), { recursive: true });
      // Mapper.java 落盘前注入 @DataPermission（坎2：让 data_scope=仅本人 真过滤；codegen 默认不带）
      let data = e.getData();
      if (name.endsWith('Mapper.java')) {
        const patched = injectDataPermission(data.toString('utf8'));
        data = Buffer.from(patched, 'utf8');
      }
      await writeFile(target, data);
      n++;
    }
    if (n === 0) throw new Error(`部署 ${table}：zip 内无 main/java|main/resources 文件（codegen 异常？）`);
    if (this.cfg.uiRoot) this.logger.log(`${table}：前端 ${vueN} 个 vue/api 文件落进 ${this.cfg.uiRoot}/src`);
    return n;
  }

  /** zip 内相对路径 → 模块源码绝对路径；非后端文件返回 null。 */
  private targetPath(name: string, moduleSrc: string): string | null {
    for (const sub of ['main/java/', 'main/resources/']) {
      if (name.startsWith(sub)) return join(moduleSrc, ...name.split(posix.sep));
    }
    return null;
  }

  /**
   * 删与本次表 @RequestMapping 撞车的旧生成物全家——解跨次置备 businessName 重名致 Spring "Ambiguous mapping" 崩库。
   * 用本次 Controller 的 @RequestMapping（Spring 真正比对的那个值）作撞车判据：扫模块 controller 目录里
   * **别的** Controller，凡声明同一 mapping 的，按其类名前缀删掉旧全家(controller/domain/bo/vo/service/impl/mapper + xml)
   * 及对应 target/classes 的 .class（否则增量编译留旧 .class，boot 仍 cp 到旧类）。
   * 全程 best-effort：找不到 mapping/目录/文件都静默跳过，绝不阻断置备。
   */
  private async cleanupCollidingMappings(entries: AdmZip.IZipEntry[], moduleSrc: string, table: string): Promise<void> {
    try {
      const ctrl = entries.find((e) => !e.isDirectory && /(?:^|\/)main\/java\/.*\/controller\/[A-Za-z0-9_]+Controller\.java$/.test(e.entryName.replace(/\\/g, '/')));
      if (!ctrl) return;
      const newMapping = this.extractMapping(ctrl.getData().toString('utf8'));
      if (!newMapping) return; // 取不到 mapping（异常 codegen）→ 不敢乱删
      const ctrlName = ctrl.entryName.replace(/\\/g, '/');
      const ctrlAbsPath = this.targetPath(ctrlName, moduleSrc)!;
      const ctrlDir = dirname(ctrlAbsPath);
      const newClass = basename(ctrlName, '.java'); // 如 StoreController
      let siblings: string[];
      try {
        siblings = await readdir(ctrlDir);
      } catch {
        return; // 目录尚不存在（首次置备）→ 无旧物可清
      }
      for (const f of siblings) {
        if (!f.endsWith('Controller.java') || f === `${newClass}.java`) continue;
        let src: string;
        try {
          src = await readFile(join(ctrlDir, f), 'utf8');
        } catch {
          continue;
        }
        if (this.extractMapping(src) !== newMapping) continue; // 不撞 mapping → 留着
        const stalePrefix = f.replace(/Controller\.java$/, ''); // 如 DemoStore
        await this.deleteGeneratedFamily(stalePrefix, ctrlDir, moduleSrc, newMapping);
        this.logger.warn(`置备清理[${table}]：旧生成物 ${f} 与本次 ${newClass} 同 @RequestMapping(${newMapping})，已删其全家(java+xml+class)`);
      }
    } catch (e) {
      this.logger.warn(`置备清理[${table}] 跳过（不阻断置备）：${e instanceof Error ? e.message : e}`);
    }
  }

  /** 从 Controller 源码取 `@RequestMapping("...")` 的路径值；取不到返回 null。 */
  private extractMapping(src: string): string | null {
    return src.match(/@RequestMapping\(\s*(?:value\s*=\s*)?"([^"]+)"/)?.[1] ?? null;
  }

  /** 删一个旧类前缀的若依 codegen 全家（java 七件 + mapper xml）及各自 target/classes 的编译产物。 */
  private async deleteGeneratedFamily(prefix: string, ctrlDir: string, moduleSrc: string, mapping: string): Promise<void> {
    const pkgDir = dirname(ctrlDir); // .../org/dromara/<module>
    const moduleName = mapping.split('/').filter(Boolean)[0] ?? 'system';
    const targets = [
      join(ctrlDir, `${prefix}Controller.java`),
      join(pkgDir, 'domain', `${prefix}.java`),
      join(pkgDir, 'domain', 'bo', `${prefix}Bo.java`),
      join(pkgDir, 'domain', 'vo', `${prefix}Vo.java`),
      join(pkgDir, 'service', `I${prefix}Service.java`),
      join(pkgDir, 'service', 'impl', `${prefix}ServiceImpl.java`),
      join(pkgDir, 'mapper', `${prefix}Mapper.java`),
      join(moduleSrc, 'main', 'resources', 'mapper', moduleName, `${prefix}Mapper.xml`),
    ];
    for (const t of targets) {
      await this.rmQuiet(t);
      const cls = this.toClassPath(t);
      if (cls) await this.rmQuiet(cls);
    }
  }

  /** src/main/{java,resources} 下源码路径 → target/classes 下编译产物路径（.java→.class）；非源码路径返回 null。 */
  private toClassPath(srcPath: string): string | null {
    const fromJava = `${sep}src${sep}main${sep}java${sep}`;
    const fromRes = `${sep}src${sep}main${sep}resources${sep}`;
    const to = `${sep}target${sep}classes${sep}`;
    let p: string;
    if (srcPath.includes(fromJava)) p = srcPath.replace(fromJava, to);
    else if (srcPath.includes(fromRes)) p = srcPath.replace(fromRes, to);
    else return null;
    return p.endsWith('.java') ? `${p.slice(0, -'.java'.length)}.class` : p;
  }

  /** rm（force：缺失不报错），任何异常静默——清理是 best-effort。 */
  private async rmQuiet(path: string): Promise<void> {
    try {
      await rm(path, { force: true });
    } catch {
      /* best-effort：清理失败不阻断置备 */
    }
  }

  private async run(cmd: string, label: string): Promise<void> {
    try {
      const { stdout } = await execAsync(cmd, { cwd: this.cfg.srcRoot, maxBuffer: 64 * 1024 * 1024 });
      this.logger.log(`${label}成功：${cmd}${stdout ? ` (${stdout.trim().slice(-120)})` : ''}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`${label}失败（${cmd}）：${msg.slice(0, 300)}`);
    }
  }
}
