import { RuoyiClientConfig } from './ruoyi-client.service';
import { RuoyiMysqlConfig } from './ruoyi-mysql-ddl.driver';
import { RuoyiDeployConfig } from './ruoyi-local-deployer';

/**
 * 私有化档若依实例的接入配置（一实例一套，env 驱动）。
 * 默认值对齐本地 docker 学习环境（ruoyi-server@8080 / ruoyi-mysql / D:\ruoyi-study），
 * 生产私有化交付时按真实例覆盖这些 env。
 */
export interface RuoyiInstanceConfig {
  client: RuoyiClientConfig;
  mysql: RuoyiMysqlConfig;
  deploy: RuoyiDeployConfig;
  /** 是否已配置（未配则 provision 不可用，端点报"未接若依实例"而非乱跑） */
  enabled: boolean;
}

export function loadRuoyiInstanceConfig(env: NodeJS.ProcessEnv = process.env): RuoyiInstanceConfig {
  const baseUrl = env.RUOYI_BASE_URL || '';
  const srcRoot = env.RUOYI_SRC_ROOT || '';
  const module = env.RUOYI_MODULE || 'ruoyi-modules/ruoyi-system';
  return {
    enabled: !!baseUrl && !!srcRoot,
    client: {
      baseUrl,
      clientId: env.RUOYI_CLIENT_ID || 'e5cd7e4891bf95d1d19206ce24a7b32e',
      username: env.RUOYI_USER || 'admin',
      password: env.RUOYI_PASS || 'admin123',
      tenantId: env.RUOYI_TENANT || '000000',
    },
    mysql: {
      host: env.RUOYI_MYSQL_HOST || '127.0.0.1',
      port: Number(env.RUOYI_MYSQL_PORT || 3306),
      user: env.RUOYI_MYSQL_USER || 'root',
      password: env.RUOYI_MYSQL_PASS || 'root',
      database: env.RUOYI_MYSQL_DB || 'ry-vue',
    },
    deploy: {
      srcRoot,
      module,
      // 私有化档默认：maven 容器单模块 compile + docker restart。生产换 k8s/systemd 改这两条 env。
      compileCmd:
        env.RUOYI_COMPILE_CMD ||
        `docker run --rm -v "${srcRoot}":/src -v ruoyi-m2:/root/.m2 -w /src maven:3.9-eclipse-temurin-17 mvn -o -q compile -pl ${module}`,
      restartCmd: env.RUOYI_RESTART_CMD || 'docker restart ruoyi-server',
      readyUrl: env.RUOYI_READY_URL || baseUrl || undefined,
      // 设了才把 codegen vue 落进 plus-ui（ADR-0012 ②，让实体成若依控制台页）。未设=只落后端。
      uiRoot: env.RUOYI_UI_ROOT || undefined,
    },
  };
}
