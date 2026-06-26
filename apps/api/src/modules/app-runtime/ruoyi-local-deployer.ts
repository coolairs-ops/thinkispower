import { Logger } from '@nestjs/common';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import AdmZip from 'adm-zip';
import { RuoyiClient, RuoyiClientConfig } from './ruoyi-client.service';
import { injectDataPermission } from './ruoyi-data-permission';

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
  async deploySources(ruoyiCfg: RuoyiClientConfig, tables: string[]): Promise<void> {
    if (!tables.length) return;
    let written = 0;
    for (const table of tables) {
      const zip = await this.client.importAndDownload(ruoyiCfg, table);
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
