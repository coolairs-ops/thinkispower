export const DEFAULT_APP_LOGIN_USERNAME = 'ceshi';
export const DEFAULT_APP_LOGIN_PASSWORD = 'ceshi123';

export function isDefaultAppLogin(username?: string, password?: string): boolean {
  return (username ?? '').trim() === DEFAULT_APP_LOGIN_USERNAME && password === DEFAULT_APP_LOGIN_PASSWORD;
}

