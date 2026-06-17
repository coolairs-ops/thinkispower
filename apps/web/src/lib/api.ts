/**
 * Frontend API helper
 * All calls go through Next.js rewrites to NestJS backend
 * Auto-refreshes access token on 401.
 */

let refreshPromise: Promise<boolean> | null = null;

const getToken = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
};

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;
  if (!refreshToken) return false;

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem('accessToken', data.accessToken);
    if (data.refreshToken) {
      localStorage.setItem('refreshToken', data.refreshToken);
    }
    return true;
  } catch {
    return false;
  }
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  // FormData(文件上传)不能设 Content-Type，需由浏览器自动带 multipart boundary
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res = await fetch(path, { ...options, headers });

  // 401 → 自动尝试 refresh token
  if (res.status === 401 && typeof window !== 'undefined') {
    if (!refreshPromise) {
      refreshPromise = tryRefreshToken();
    }
    const refreshed = await refreshPromise;
    refreshPromise = null;

    if (refreshed) {
      // 续期成功：用新 token 重试，结果交给下面统一的 ok / 业务错误处理，
      // 不在此因业务级 4xx/5xx 误登出（仅续期失败才登出）
      headers['Authorization'] = `Bearer ${getToken()}`;
      res = await fetch(path, { ...options, headers });
    } else {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      window.location.href = '/';
      throw new Error('登录已过期，请重新登录');
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: '请求失败' }));
    const err = new Error(body.message || '请求失败');
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, body?: any) => request(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: (path: string, body?: any) => request(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: (path: string, body?: any) => request(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
  /** 文件上传(multipart)：传入 FormData，自动带 auth 与 401 刷新 */
  upload: (path: string, formData: FormData) => request(path, { method: 'POST', body: formData }),
};
