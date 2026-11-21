import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config.ts';
import { isSupabaseConfigured } from './config.ts';
import { createAuthedSupabaseClient, createPublicSupabaseClient } from './supabase.ts';

export interface AuthenticatedAdmin {
  userId: string;
  email: string;
  role: string;
  csrfToken: string;
  expiresAt: string;
  accessToken: string;
}

export interface AdminRequest extends Request {
  admin?: AuthenticatedAdmin;
  supabase?: SupabaseClient;
}

export function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

export function isValidEmail(email: string): boolean {
  const trimmed = String(email || '').trim();
  return trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function isValidPhone(phone: string): boolean {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function slugify(input: string): string {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function sanitizeImageUrl(url: string | undefined, fallback: string): string {
  const raw = String(url || '').trim();
  if (!raw) return fallback;
  if (/^(javascript|data|vbscript|file):/i.test(raw) || raw.startsWith('//') || raw.includes('..')) {
    return fallback;
  }
  if (/^https?:\/\/[^\s"'<>]+$/i.test(raw)) {
    return raw;
  }
  if (/^assets\/[a-zA-Z0-9._/-]+$/.test(raw)) {
    return raw;
  }
  return fallback;
}

export function sanitizeExternalUrl(url: unknown): string {
  const raw = String(url || '').trim();
  if (!raw || raw.length > 500) return '';
  if (/^(javascript|data|vbscript|file):/i.test(raw) || raw.startsWith('//')) {
    return '';
  }
  if (/^https?:\/\/[^\s"'<>]+$/i.test(raw)) {
    return raw;
  }
  return '';
}

export function sanitizeWhatsAppContact(rawInput: unknown): { value: string; href: string } {
  const raw = String(rawInput || '').trim().slice(0, 200);
  if (!raw) return { value: '', href: '' };
  if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/[^\s"'<>]+$/i.test(raw)) {
    return { value: raw, href: raw };
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 7 && digits.length <= 15) {
    return { value: raw, href: `https://wa.me/${digits}` };
  }
  return { value: '', href: '' };
}

export function sanitizeTelegramContact(rawInput: unknown): { value: string; href: string } {
  const raw = String(rawInput || '').trim().slice(0, 200);
  if (!raw) return { value: '', href: '' };
  const urlMatch = raw.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_+/=-]+)\/?$/i);
  if (urlMatch) {
    const target = urlMatch[1];
    const cleanUrl = `https://t.me/${target}`;
    if (/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(target)) {
      return { value: `@${target}`, href: cleanUrl };
    }
    return { value: cleanUrl, href: cleanUrl };
  }
  const handle = raw.replace(/^@+/, '');
  if (/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(handle)) {
    return { value: `@${handle}`, href: `https://t.me/${handle}` };
  }
  return { value: '', href: '' };
}

export function sanitizeKeyValueMap(
  input: unknown,
  maxEntries: number = 30
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return out;
  }
  let count = 0;
  for (const [rawKey, rawVal] of Object.entries(input as Record<string, unknown>)) {
    if (count >= maxEntries) break;
    const key = String(rawKey || '').trim().slice(0, 80);
    const val = String(rawVal ?? '').trim().slice(0, 300);
    if (!key || !val) continue;
    out[key] = val;
    count += 1;
  }
  return out;
}

export interface SanitizedSellerContact {
  contactName: string;
  email: string;
  phone: string;
  whatsapp: string;
  whatsappUrl: string;
  telegram: string;
  telegramUrl: string;
  otherLabel: string;
  otherUrl: string;
  notes: string;
}

export function sanitizeSellerContact(input: unknown): SanitizedSellerContact {
  const obj = (input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : {}) as Record<string, unknown>;
  const emailRaw = String(obj.email || '').trim().toLowerCase();
  const phoneRaw = String(obj.phone || '').trim().slice(0, 40);
  const wa = sanitizeWhatsAppContact(obj.whatsapp);
  const tg = sanitizeTelegramContact(obj.telegram);
  const otherUrl = sanitizeExternalUrl(obj.otherUrl);

  return {
    contactName: String(obj.contactName || '').trim().slice(0, 100),
    email: isValidEmail(emailRaw) ? emailRaw : '',
    phone: phoneRaw && isValidPhone(phoneRaw) ? phoneRaw : '',
    whatsapp: wa.value,
    whatsappUrl: wa.href,
    telegram: tg.value,
    telegramUrl: tg.href,
    otherLabel: String(obj.otherLabel || '').trim().slice(0, 60),
    otherUrl,
    notes: String(obj.notes || '').trim().slice(0, 400),
  };
}

export function detectImageMagicBytes(
  buffer: Buffer
): { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' } | null {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

export function parseCents(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100);
  }
  const str = String(value ?? '').trim();
  if (!str) return null;
  if (/^free\b/i.test(str)) return 0;
  const cleaned = str.replace(/^(?:CA\$|US\$|[$€£])\s*/i, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function securityHeadersMiddleware(cfg: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');

    const isAdminRequest =
      (cfg.adminSecretPath && req.path.startsWith(`/${cfg.adminSecretPath}`)) ||
      req.path.startsWith('/api/admin');

    if (isAdminRequest || !cfg.allowIframePreview) {
      res.setHeader('X-Frame-Options', 'DENY');
    }

    if (cfg.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' https: data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ];
    if (isAdminRequest || !cfg.allowIframePreview) {
      cspDirectives.push("frame-ancestors 'none'");
    }
    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

    if (isAdminRequest) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
    }

    next();
  };
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
}) {
  const buckets = new Map<string, RateBucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (buckets.size > 5000) {
      for (const [k, b] of buckets.entries()) {
        if (b.resetAt <= now) buckets.delete(k);
      }
    }

    const key = `${options.keyPrefix}:${getClientIp(req)}`;
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > options.max) {
      const retrySec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySec));
      res.status(429).json({
        error:
          options.message ||
          'Too many requests. Please wait a moment before trying again.',
      });
      return;
    }

    next();
  };
}

export interface LoginBruteForceGuard {
  check(ip: string, email: string): { allowed: true } | { allowed: false; retryAfterSeconds: number };
  recordFailure(ip: string, email: string): {
    locked: boolean;
    remainingAttempts: number;
    retryAfterSeconds: number;
  };
  recordSuccess(ip: string, email: string): void;
}

interface LoginAttemptRecord {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
  lockoutCount: number;
}

/**
 * Server-side brute-force login protection:
 * - Tracks repeated failed login attempts per IP and per (IP, email) pair.
 * - Triggers a temporary cooldown after maxFailures (default 5) within windowMs (15m).
 * - Progressive cooldown: 5 min -> 15 min -> 30 min max on repeated lockouts.
 * - Clears failure history immediately upon successful authentication.
 */
export function createLoginBruteForceGuard(options?: {
  maxFailures?: number;
  windowMs?: number;
  baseCooldownMs?: number;
  maxCooldownMs?: number;
}): LoginBruteForceGuard {
  const maxFailures = options?.maxFailures ?? 5;
  const windowMs = options?.windowMs ?? 15 * 60 * 1000;
  const baseCooldownMs = options?.baseCooldownMs ?? 5 * 60 * 1000;
  const maxCooldownMs = options?.maxCooldownMs ?? 30 * 60 * 1000;
  const records = new Map<string, LoginAttemptRecord>();

  const prune = (now: number) => {
    if (records.size <= 5000) return;
    for (const [key, rec] of records.entries()) {
      if (rec.lockedUntil <= now && now - rec.firstFailureAt > windowMs * 2) {
        records.delete(key);
      }
    }
  };

  const keysFor = (ip: string, email: string): string[] => {
    const cleanIp = String(ip || 'unknown').trim().toLowerCase();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const list = [`ip:${cleanIp}`];
    if (cleanEmail) {
      list.push(`ip_email:${cleanIp}:${cleanEmail}`);
    }
    return list;
  };

  return {
    check(ip: string, email: string) {
      const now = Date.now();
      prune(now);
      let maxRetryMs = 0;
      for (const key of keysFor(ip, email)) {
        const rec = records.get(key);
        if (rec && rec.lockedUntil > now) {
          maxRetryMs = Math.max(maxRetryMs, rec.lockedUntil - now);
        }
      }
      if (maxRetryMs > 0) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(maxRetryMs / 1000)),
        };
      }
      return { allowed: true };
    },

    recordFailure(ip: string, email: string) {
      const now = Date.now();
      prune(now);
      let locked = false;
      let maxRetryMs = 0;
      let minRemaining = maxFailures;

      for (const key of keysFor(ip, email)) {
        const isIpOnly = key.startsWith('ip:');
        // Allow slightly higher threshold for shared NAT IPs vs specific (IP, email)
        const limit = isIpOnly ? maxFailures * 2 : maxFailures;
        let rec = records.get(key);
        if (!rec || (rec.lockedUntil <= now && now - rec.firstFailureAt > windowMs)) {
          rec = {
            failures: 0,
            firstFailureAt: now,
            lockedUntil: 0,
            lockoutCount: rec && now - rec.firstFailureAt <= windowMs * 4 ? rec.lockoutCount : 0,
          };
        }

        rec.failures += 1;
        if (rec.failures >= limit) {
          rec.lockoutCount += 1;
          const multiplier = Math.pow(3, Math.min(rec.lockoutCount - 1, 2));
          const cooldownMs = Math.min(maxCooldownMs, baseCooldownMs * multiplier);
          rec.lockedUntil = now + cooldownMs;
          rec.failures = 0;
          rec.firstFailureAt = now;
          locked = true;
          maxRetryMs = Math.max(maxRetryMs, cooldownMs);
          minRemaining = 0;
        } else if (!isIpOnly) {
          minRemaining = Math.min(minRemaining, Math.max(0, limit - rec.failures));
        }

        records.set(key, rec);
      }

      return {
        locked,
        remainingAttempts: minRemaining,
        retryAfterSeconds: locked ? Math.max(1, Math.ceil(maxRetryMs / 1000)) : 0,
      };
    },

    recordSuccess(ip: string, email: string) {
      const cleanIp = String(ip || 'unknown').trim().toLowerCase();
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (cleanEmail) {
        records.delete(`ip_email:${cleanIp}:${cleanEmail}`);
      }
      records.delete(`ip:${cleanIp}`);
    },
  };
}

export function setAdminAuthCookies(
  res: Response,
  cfg: AppConfig,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string; expiresInSec?: number }
): void {
  const accessMaxAgeMs = Math.max(900, tokens.expiresInSec || 3600) * 1000;
  const refreshMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
  const baseOpts = {
    httpOnly: true,
    secure: cfg.isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };
  res.cookie(cfg.adminAccessCookieName, tokens.accessToken, {
    ...baseOpts,
    maxAge: accessMaxAgeMs,
  });
  res.cookie(cfg.adminRefreshCookieName, tokens.refreshToken, {
    ...baseOpts,
    maxAge: refreshMaxAgeMs,
  });
  res.cookie(cfg.adminCsrfCookieName, tokens.csrfToken, {
    ...baseOpts,
    maxAge: refreshMaxAgeMs,
  });
}

export function clearAdminAuthCookies(res: Response, cfg: AppConfig): void {
  const baseOpts = {
    httpOnly: true,
    secure: cfg.isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };
  res.clearCookie(cfg.adminAccessCookieName, baseOpts);
  res.clearCookie(cfg.adminRefreshCookieName, baseOpts);
  res.clearCookie(cfg.adminCsrfCookieName, baseOpts);
}

export async function getAuthenticatedAdmin(
  cfg: AppConfig,
  req: Request,
  res?: Response
): Promise<{ admin: AuthenticatedAdmin; supabase: SupabaseClient } | null> {
  if (!isSupabaseConfigured(cfg)) {
    return null;
  }

  let accessToken = String(req.cookies?.[cfg.adminAccessCookieName] || '').trim();
  const refreshToken = String(req.cookies?.[cfg.adminRefreshCookieName] || '').trim();
  const csrfToken = String(req.cookies?.[cfg.adminCsrfCookieName] || '').trim();

  if ((!accessToken && !refreshToken) || !csrfToken) {
    return null;
  }

  const publicClient = createPublicSupabaseClient(cfg);
  let user = null;
  let expiresAtIso = '';

  if (accessToken) {
    const { data, error } = await publicClient.auth.getUser(accessToken);
    if (!error && data?.user) {
      user = data.user;
    }
  }

  // Attempt transparent refresh if access token expired but refresh token is valid
  if (!user && refreshToken) {
    const { data, error } = await publicClient.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (!error && data?.session && data?.user) {
      accessToken = data.session.access_token;
      user = data.user;
      expiresAtIso = data.session.expires_at
        ? new Date(data.session.expires_at * 1000).toISOString().replace('T', ' ').slice(0, 19)
        : '';
      if (res) {
        setAdminAuthCookies(res, cfg, {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          csrfToken,
          expiresInSec: data.session.expires_in,
        });
      }
    }
  }

  if (!user || !accessToken) {
    return null;
  }

  const authedClient = createAuthedSupabaseClient(cfg, accessToken);
  const { data: adminRow, error: adminErr } = await authedClient
    .from('admin_users')
    .select('user_id, email, role, active')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (adminErr || !adminRow) {
    return null;
  }

  if (!expiresAtIso) {
    try {
      const payloadPart = accessToken.split('.')[1];
      if (payloadPart) {
        const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
        if (decoded?.exp) {
          expiresAtIso = new Date(Number(decoded.exp) * 1000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 19);
        }
      }
    } catch {
      expiresAtIso = '';
    }
  }

  return {
    admin: {
      userId: String(adminRow.user_id),
      email: String(adminRow.email || user.email || ''),
      role: String(adminRow.role || 'admin'),
      csrfToken,
      expiresAt: expiresAtIso || 'Active Session',
      accessToken,
    },
    supabase: authedClient,
  };
}

export function requireAdminAuth(cfg: AppConfig) {
  return async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const resolved = await getAuthenticatedAdmin(cfg, req, res);
      if (!resolved) {
        res.status(401).json({ error: 'Administrator authentication required.' });
        return;
      }
      req.admin = resolved.admin;
      req.supabase = resolved.supabase;
      next();
    } catch {
      res.status(401).json({ error: 'Administrator authentication required.' });
    }
  };
}

export function requireAdminCsrf(req: AdminRequest, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    next();
    return;
  }
  const admin = req.admin;
  if (!admin) {
    res.status(401).json({ error: 'Administrator authentication required.' });
    return;
  }
  const headerToken = String(req.headers['x-csrf-token'] || '').trim();
  if (!headerToken || !timingSafeEqualStr(headerToken, admin.csrfToken)) {
    res.status(403).json({ error: 'Invalid or missing CSRF security token.' });
    return;
  }
  next();
}

export async function writeAuditLog(
  supabase: SupabaseClient,
  entry: {
    adminUserId?: string | null;
    adminEmail?: string;
    action: string;
    targetType?: string;
    targetId?: string | number;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      admin_user_id: entry.adminUserId ?? null,
      admin_email: entry.adminEmail || '',
      action: entry.action,
      target_type: entry.targetType || '',
      target_id: entry.targetId !== undefined ? String(entry.targetId) : '',
      details_json: entry.details || {},
      ip_address: entry.ipAddress || '',
    });
  } catch {
    // Non-fatal audit logging failure
  }
}
