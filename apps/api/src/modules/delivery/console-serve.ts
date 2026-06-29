import { createServer, request as httpRequest, IncomingMessage, ServerResponse, Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';

/**
 * 控制台「托管 serve」基建（候选② serve 自动化）：让平台自己把 plus-ui 构建产物 `dist` serve 出来
 * 并产出 productionUrl，替代手工 `vite preview` / 手配 nginx。零新依赖（Node 内置 http）。
 *
 * 设计要点：
 * - 与冒烟/守护同口径：代理前缀走 RUOYI_CONSOLE_API_PREFIX(默认 /prod-api)，**剥前缀**转发到 RUOYI_BASE_URL
 *   （对齐 RUNBOOK §5 nginx 的 `proxy_pass http://…:8080/` 行为），否则冒烟会假阴。
 * - SPA history fallback：无扩展名的路由 → index.html；带扩展名却缺文件 → 404（不掩盖构建缺资源）。
 * - 默认**关闭**（向后兼容）：仅 RUOYI_CONSOLE_SERVE=managed 才接管；否则 productionUrl 仍回落 RUOYI_CONSOLE_URL。
 */

export interface ConsoleServeConfig {
  host: string;
  /** 监听端口；0 = 临时端口（实际端口监听后从 address() 读取）。 */
  port: number;
  apiPrefix: string;
  /** 显式对外 URL（反代/域名场景 RUOYI_CONSOLE_PUBLIC_URL）。未设则由实际监听端口产出 http://host:port。 */
  publicUrl?: string;
}

/** 解析托管 serve 配置；未开启（RUOYI_CONSOLE_SERVE !== 'managed'）返回 null → 调用方回落 env。纯函数。 */
export function resolveConsoleServeConfig(env: NodeJS.ProcessEnv = process.env): ConsoleServeConfig | null {
  if (env.RUOYI_CONSOLE_SERVE !== 'managed') return null;
  const host = env.RUOYI_CONSOLE_SERVE_HOST || '127.0.0.1';
  const portEnv = env.RUOYI_CONSOLE_SERVE_PORT;
  const port = portEnv !== undefined && portEnv !== '' ? Number(portEnv) : 8089;
  const rawPrefix = env.RUOYI_CONSOLE_API_PREFIX || '/prod-api';
  const apiPrefix = ('/' + rawPrefix.replace(/^\/+|\/+$/g, '')); // 规范化：单前导斜杠、无尾斜杠
  const publicUrl = env.RUOYI_CONSOLE_PUBLIC_URL?.replace(/\/+$/, '') || undefined;
  return { host, port, apiPrefix, publicUrl };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function mimeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export interface ConsoleServerOptions {
  /** plus-ui build:prod 产物目录（含 index.html）。文件实时读盘，重构建自动反映，无需重启。 */
  distDir: string;
  /** 若依后端地址（RUOYI_BASE_URL），代理转发目标。 */
  backendUrl: string;
  /** 代理前缀（已规范化，含前导斜杠、无尾斜杠）。 */
  apiPrefix: string;
}

/**
 * 构造控制台静态+代理服务器（**未监听**，便于单测/由 service 负责 listen）。
 */
export function createConsoleServer(opts: ConsoleServerOptions): Server {
  const distRoot = resolve(opts.distDir);
  const indexPath = join(distRoot, 'index.html');

  return createServer((req, res) => {
    const rawUrl = req.url || '/';
    // 命中代理前缀（精确 == 前缀 或 前缀+'/'）→ 反代若依
    if (rawUrl === opts.apiPrefix || rawUrl.startsWith(opts.apiPrefix + '/')) {
      proxyToBackend(req, res, opts.backendUrl, opts.apiPrefix);
      return;
    }
    serveStatic(rawUrl, res, distRoot, indexPath);
  });
}

/** 反代：剥前缀后转发到 backendUrl + 剩余路径。 */
function proxyToBackend(req: IncomingMessage, res: ServerResponse, backendUrl: string, apiPrefix: string): void {
  let target: URL;
  try {
    target = new URL(backendUrl);
  } catch {
    res.writeHead(502).end('bad backend url');
    return;
  }
  const rest = (req.url || '').slice(apiPrefix.length) || '/';
  const path = (target.pathname.replace(/\/$/, '') || '') + (rest.startsWith('/') ? rest : '/' + rest);
  const isHttps = target.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;
  const headers = { ...req.headers, host: target.host };

  const proxyReq = requestFn(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      method: req.method,
      path,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502);
    res.end(`console proxy error: ${e.message}`);
  });
  req.pipe(proxyReq);
}

/** 静态文件 + SPA history fallback。 */
function serveStatic(rawUrl: string, res: ServerResponse, distRoot: string, indexPath: string): void {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawUrl.split('?')[0].split('#')[0]);
  } catch {
    res.writeHead(400).end('bad request'); // 畸形 %xx 编码
    return;
  }
  // 根 / → index.html
  if (pathname === '/' || pathname === '') {
    return sendFile(indexPath, res, () => res.writeHead(404).end('console not built'));
  }
  // 防目录穿越
  const resolved = resolve(distRoot, '.' + pathname);
  if (resolved !== distRoot && !resolved.startsWith(distRoot + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (existsSync(resolved) && statSync(resolved).isFile()) {
    return sendFile(resolved, res);
  }
  // 带扩展名却缺文件 → 真 404（不掩盖构建缺资源）；无扩展名（路由）→ SPA fallback
  const hasExt = !!extname(pathname);
  if (hasExt) {
    res.writeHead(404).end('not found');
    return;
  }
  sendFile(indexPath, res, () => res.writeHead(404).end('console not built'));
}

function sendFile(filePath: string, res: ServerResponse, onMissing?: () => void): void {
  if (!existsSync(filePath)) {
    if (onMissing) return onMissing();
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
  createReadStream(filePath).pipe(res);
}
