import { RuoyiClient, RuoyiClientConfig } from './ruoyi-client.service';
import { RuoyiRuntime, RuoyiProvisionInfra } from './ruoyi-runtime.service';
import { RuoyiMysqlDdlDriver } from './ruoyi-mysql-ddl.driver';
import { RuoyiLocalDeployer } from './ruoyi-local-deployer';
import { AppSpec } from './app-spec.types';
import { ModelField, ParsedModel } from './data-model.types';

/**
 * 全自动 provision 端到端（私有化档）。**仅当 RUOYI_E2E=1 时运行**——慢（含 ~分钟级编译+重启）且会改实例。
 * 证明：一个全新实体 → 无人工 → 真 CRUD 端点活。跑法（对正在跑的 exploded 若依）：
 *   RUOYI_E2E=1 RUOYI_BASE_URL=http://127.0.0.1:8080 RUOYI_SRC_ROOT='D:\ruoyi-study' \
 *   npx jest ruoyi-provision.e2e
 */
const e2e = process.env.RUOYI_E2E ? it : it.skip;

const f = (name: string, over: Partial<ModelField> = {}): ModelField => ({
  name, prismaType: 'String', optional: false, isId: false, isUnique: false, ...over,
});

describe('若依全自动 provision E2E（新实体→真 CRUD，零人工）', () => {
  e2e('provisionApp 跑完整链后 /system/member/list 返回 200', async () => {
    const baseUrl = process.env.RUOYI_BASE_URL!;
    const srcRoot = process.env.RUOYI_SRC_ROOT!;
    const module = process.env.RUOYI_MODULE || 'ruoyi-modules/ruoyi-system';
    const clientCfg: RuoyiClientConfig = {
      baseUrl,
      clientId: process.env.RUOYI_CLIENT_ID || 'e5cd7e4891bf95d1d19206ce24a7b32e',
      username: process.env.RUOYI_USER || 'admin',
      password: process.env.RUOYI_PASS || 'admin123',
      tenantId: process.env.RUOYI_TENANT || '000000',
    };

    // 全新实体（库里没有，DDL 现建，含若依基础列由 toMysqlCreateTable 自动补）
    const member: ParsedModel = {
      name: 'DemoMember',
      table: 'demo_member',
      fields: [f('id', { isId: true, prismaType: 'BigInt' }), f('member_name'), f('phone'), f('level', { prismaType: 'Int' })],
    };
    const spec: AppSpec = { entities: [member], roles: [{ name: '会员管理员', dataScope: '1' }], menus: [] };

    const client = new RuoyiClient();
    const infra: RuoyiProvisionInfra = {
      applyDdl: (s) => new RuoyiMysqlDdlDriver({
        host: process.env.RUOYI_MYSQL_HOST || '127.0.0.1',
        port: Number(process.env.RUOYI_MYSQL_PORT || 3306),
        user: process.env.RUOYI_MYSQL_USER || 'root',
        password: process.env.RUOYI_MYSQL_PASS || 'root',
        database: process.env.RUOYI_MYSQL_DB || 'ry-vue',
      }).applyDdl(s),
      deployTables: (rcfg, tables) => new RuoyiLocalDeployer(client, {
        srcRoot, module,
        compileCmd: process.env.RUOYI_COMPILE_CMD ||
          `docker run --rm -v "${srcRoot}":/src -v ruoyi-m2:/root/.m2 -w /src maven:3.9-eclipse-temurin-17 mvn -o -q compile -pl ${module}`,
        restartCmd: process.env.RUOYI_RESTART_CMD || 'docker restart ruoyi-server',
        readyUrl: baseUrl,
        readyTimeoutMs: 16 * 60 * 1000,
      }).deployTables(rcfg, tables),
    };

    const res = await new RuoyiRuntime(client).provisionApp('e2e-proj', spec, clientCfg, infra);
    expect(res.descriptor.resources).toContain('demo_member');

    // 实例已就绪（deployer 探活过）→ 真访问新 CRUD 端点
    const token = await client.login(clientCfg);
    const r = await fetch(`${baseUrl}/system/member/list?pageNum=1&pageSize=10`, {
      headers: { Authorization: `Bearer ${token}`, clientid: clientCfg.clientId },
    });
    const body = (await r.json()) as { code: number };
    expect(r.status).toBe(200);
    expect(body.code).toBe(200);
  }, 20 * 60 * 1000);
});
