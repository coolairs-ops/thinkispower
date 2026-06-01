/**
 * Frontend API helper
 * All calls go through Next.js rewrites to NestJS backend
 */

const getToken = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
};

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/';
    }
    throw new Error('登录已过期，请重新登录');
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
};
