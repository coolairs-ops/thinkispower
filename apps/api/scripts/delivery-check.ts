import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SchemaMigrationService } from '../src/modules/app-runtime/schema-migration.service';
import { AppSpecAssemblerService } from '../src/modules/app-runtime/app-spec-assembler.service';
import { RuoyiCoverageService } from '../src/modules/app-runtime/ruoyi-coverage.service';
import { DeliveryCheckMode, DeliveryPackageCheckService } from '../src/modules/delivery/delivery-package-check.service';

type OutputFormat = 'text' | 'json';

interface Args {
  projectId?: string;
  mode: DeliveryCheckMode;
  format: OutputFormat;
  out?: string;
  strict: boolean;
  help: boolean;
}

const apiRoot = resolve(__dirname, '..');
loadEnv(resolve(apiRoot, '.env'));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('缺少 DATABASE_URL。请在 apps/api/.env 中配置，或在命令行环境中提供。');
  }

  const prisma = new PrismaClient();
  const service = createService(prisma);
  try {
    const report = await service.run({ projectId: args.projectId, mode: args.mode, out: args.out });

    if (args.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(service.renderMarkdown(report));
    }

    if (args.strict && report.overall.status !== 'pass') {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

function createService(prisma: PrismaClient) {
  const schema = new SchemaMigrationService(prisma as never);
  const assembler = new AppSpecAssemblerService(prisma as never, schema);
  const coverage = new RuoyiCoverageService();
  return new DeliveryPackageCheckService(prisma as never, schema, assembler, coverage);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'inspect', format: 'text', strict: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} 需要一个值`);
      return v;
    };
    if (a.startsWith('--projectId=')) args.projectId = a.slice('--projectId='.length);
    else if (a.startsWith('--project-id=')) args.projectId = a.slice('--project-id='.length);
    else if (a === '--projectId' || a === '--project-id' || a === '-p') args.projectId = next();
    else if (a.startsWith('--mode=')) {
      const mode = a.slice('--mode='.length);
      if (mode !== 'inspect' && mode !== 'package') throw new Error(`不支持的 mode: ${mode}`);
      args.mode = mode;
    }
    else if (a === '--mode') {
      const mode = next();
      if (mode !== 'inspect' && mode !== 'package') throw new Error(`不支持的 mode: ${mode}`);
      args.mode = mode;
    } else if (a === '--json') args.format = 'json';
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else if (a === '--out') args.out = next();
    else if (a === '--strict') args.strict = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`思想动力交付包验收脚本

用法：
  npm run delivery:check -- --projectId=<projectId>
  npm run delivery:check -- --projectId=<projectId> --mode=package
  npm run delivery:check -- --projectId=<projectId> --json --strict

参数：
  --projectId, -p   项目 ID；不传则取最近更新的项目
  --mode            inspect(默认，只读输出) | package(额外写入报告文件)
  --json            输出 JSON
  --out             package 模式报告路径，默认 .hermes/delivery-checks/<projectId>/delivery-check.json
  --strict          总体非 pass 时返回退出码 1，适合 CI/打包门禁
`);
}

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

main().catch((e) => {
  console.error(formatFatal(e));
  process.exit(1);
});

function formatFatal(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("Can't reach database server")) {
    return [
      message,
      '',
      '提示：当前脚本需要能访问平台 Postgres。',
      '如果你在宿主机直接运行，而 apps/api/.env 使用的是容器内地址 postgres:5432，',
      '请临时覆盖 DATABASE_URL 为宿主机可访问地址，例如 docker-compose 默认暴露的 127.0.0.1:5433。',
    ].join('\n');
  }
  return message;
}
