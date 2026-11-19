import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from './config.ts';
import type { DbConnection } from './db.ts';

export interface AuthenticatedAdmin {
  sessionId: number;
  userId: number;
  email: string;
  role: string;
  csrfToken: string;
  expiresAt: string;
}

export interface AdminRequest extends Request {
  admin?: AuthenticatedAdmin;
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
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

export function isStrongPassword(password: string): { valid: boolean; reason?: string } {
  const val = String(password || '');
  if (val.length < 12) {
    return { valid: false, reason: 'Password must be at least 12 characters long.' };
  }
  if (!/[a-z]/.test(val) || !/[A-Z]/.test(val) || !/\d/.test(val) || !/[^A-Za-z0-9]/.test(val)) {
    return {
      valid: false,
      reason: 'Password must include uppercase, lowercase, a number, and a special character.',
    };
  }
  return { valid: true };
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
  // Block protocol-relative URLs, javascript:, data:, vbscript:, or path traversal
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
      "form-action 'self' https://testsecureacceptance.cybersource.com https://secureacceptance.cybersource.com",
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
    // Opportunistic cleanup to keep memory bounded
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

export function getAuthenticatedAdmin(
  db: DbConnection,
  cfg: AppConfig,
  req: Request
): AuthenticatedAdmin | null {
  const rawToken = req.cookies?.[cfg.adminCookieName];
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) {
    return null;
  }

  const tokenHash = sha256Hex(rawToken);
  const row = db
    .prepare(
      `
      SELECT
        s.id AS session_id,
        s.csrf_token,
        s.expires_at,
        u.id AS user_id,
        u.email,
        u.role,
        u.active
      FROM admin_sessions s
      JOIN admin_users u ON u.id = s.admin_user_id
      WHERE s.token_hash = ?
        AND s.expires_at > datetime('now')
      LIMIT 1
    `
    )
    .get(tokenHash) as
    | {
        session_id: number;
        csrf_token: string;
        expires_at: string;
        user_id: number;
        email: string;
        role: string;
        active: number;
      }
    | undefined;

  if (!row || row.active !== 1) {
    return null;
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
  };
}

export function requireAdminAuth(db: DbConnection, cfg: AppConfig) {
  return (req: AdminRequest, res: Response, next: NextFunction) => {
    const admin = getAuthenticatedAdmin(db, cfg, req);
    if (!admin) {
      res.status(401).json({ error: 'Administrator authentication required.' });
      return;
    }
    req.admin = admin;
    next();
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

export function writeAuditLog(
  db: DbConnection,
  entry: {
    adminUserId?: number | null;
    adminEmail?: string;
    action: string;
    targetType?: string;
    targetId?: string | number;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }
): void {
  db.prepare(
    `
    INSERT INTO audit_logs (
      admin_user_id, admin_email, action, target_type, target_id, details_json, ip_address
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    entry.adminUserId ?? null,
    entry.adminEmail || '',
    entry.action,
    entry.targetType || '',
    entry.targetId !== undefined ? String(entry.targetId) : '',
    JSON.stringify(entry.details || {}),
    entry.ipAddress || ''
  );
}

export function setAdminSessionCookie(
  res: Response,
  cfg: AppConfig,
  rawSessionToken: string
): void {
  res.cookie(cfg.adminCookieName, rawSessionToken, {
    httpOnly: true,
    secure: cfg.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: cfg.adminSessionTtlMinutes * 60 * 1000,
  });
}

export function clearAdminSessionCookie(res: Response, cfg: AppConfig): void {
  res.clearCookie(cfg.adminCookieName, {
    httpOnly: true,
    secure: cfg.isProduction,
    sameSite: 'strict',
    path: '/',
  });
}
