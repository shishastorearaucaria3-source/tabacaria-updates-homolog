import crypto from 'node:crypto';
import { logger } from '../logger.js';

const TAG = 'PANEL';
const sessions = new Map<string, number>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function checkCredentials(user: string, password: string, cfg: { user: string; password: string }): boolean {
  const expUser = cfg.user || 'admin';
  const expPass = cfg.password || '';
  if (!expPass) return false;
  const a = Buffer.from(String(user || ''));
  const b = Buffer.from(expUser);
  const c = Buffer.from(String(password || ''));
  const d = Buffer.from(expPass);
  const userOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  const passOk = c.length === d.length && crypto.timingSafeEqual(c, d);
  return userOk && passOk;
}

export function createSession(): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function validateSession(token: string): boolean {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

export function requireAuth(req: { headers: Record<string, string | undefined> }): boolean {
  const header = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) {
    logger.debug(TAG, 'sem token');
    return false;
  }
  return validateSession(m[1].trim());
}
