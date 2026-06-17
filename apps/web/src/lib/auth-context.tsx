'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  name: string;
  plan?: string;
}

interface AuthContextValue {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('accessToken');
    if (!stored) {
      setIsLoading(false);
      return;
    }
    setToken(stored);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const fetchMe = (tok: string) =>
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${tok}` }, signal: controller.signal });

    // access token 过期时先用 refreshToken 续期，续期成功才继续——避免「过 15 分钟刷新页面即被登出」丢会话
    const tryRefresh = async (): Promise<string | null> => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return null;
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = await res.json();
        localStorage.setItem('accessToken', data.accessToken);
        if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
        return data.accessToken as string;
      } catch {
        return null;
      }
    };

    (async () => {
      try {
        let res = await fetchMe(stored);
        if (res.status === 401) {
          const refreshed = await tryRefresh();
          if (refreshed) {
            setToken(refreshed);
            res = await fetchMe(refreshed);
          }
        }
        if (!res.ok) throw new Error('invalid token');
        const data = await res.json();
        setUser({ id: data.id, email: data.email, name: data.name, plan: data.plan });
      } catch {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        setToken(null);
        setUser(null);
      } finally {
        clearTimeout(timeout);
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '登录失败' }));
      throw new Error(err.message || '登录失败');
    }
    const data = await res.json();
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setToken(data.accessToken);
    setUser(data.user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '注册失败' }));
      throw new Error(err.message || '注册失败');
    }
    const data = await res.json();
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setToken(data.accessToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setToken(null);
    setUser(null);
    router.push('/');
  }, [router]);

  return (
    <AuthContext.Provider value={{ token, user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
