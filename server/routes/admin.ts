import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import type { AppConfig } from '../config.ts';
import { getCryptoVerifierStatus, getMissingCyberSourceVars, getMissingSmtpVars } from '../config.ts';
import type { DbConnection } from '../db.ts';
import { purgeExpiredAdminSessions, runInTransaction } from '../db.ts';
import type { AdminRequest } from '../security.ts';
import {
  clearAdminSessionCookie,
  createRateLimiter,
  generateSecureToken,
  getAuthenticatedAdmin,
  getClientIp,
  isStrongPassword,
  isValidEmail,
  parseCents,
  requireAdminAuth,
  requireAdminCsrf,
  sanitizeImageUrl,
  setAdminSessionCookie,
  sha256Hex,
  slugify,
  writeAuditLog,
} from '../security.ts';
import { EmailNotConfiguredError, isEmailConfigured, sendAdminPasswordResetEmail } from '../mailer.ts';

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

const ALLOWED_ORDER_STATUSES = ['Pending', 'Processing', 'Shipped', 'Completed', 'Cancelled'];
const ALLOWED_PAYMENT_STATUSES = [
  'Pending',
  'Awaiting Verification',
  'Paid',
  'Failed',
  'Cancelled',
  'Refunded',
];

function renderPrivateAdminHtml(fileName: string, adminBasePath: string): string {
  const filePath = path.resolve(process.cwd(), 'private', 'admin', fileName);
  const html = fs.readFileSync(filePath, 'utf8');
  return html.replace(/__ADMIN_BASE__/g, adminBasePath);
}

export function createPrivateAdminPageRouter(db: DbConnection, cfg: AppConfig) {
  const router = express.Router();
  const basePath = `/${cfg.adminSecretPath}`;

  // Static admin-only assets (CSS/JS) served ONLY under the secret private route
  router.get('/assets/admin.css', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.sendFile(path.resolve(process.cwd(), 'private', 'admin', 'admin.css'));
  });

  router.get('/assets/admin-login.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.sendFile(path.resolve(process.cwd(), 'private', 'admin', 'admin-login.js'));
  });

  router.get('/assets/admin-dashboard.js', (req: Request, res: Response) => {
    const admin = getAuthenticatedAdmin(db, cfg, req);
    if (!admin) {
      res.status(401).send('// Unauthorized');
      return;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.sendFile(path.resolve(process.cwd(), 'private', 'admin', 'admin-dashboard.js'));
  });

  // Dedicated Private Admin Login Page
  router.get('/login', (req: Request, res: Response) => {
    const admin = getAuthenticatedAdmin(db, cfg, req);
    if (admin) {
      res.redirect(302, `${basePath}/`);
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPrivateAdminHtml('login.html', basePath));
  });

  // Dedicated Private Admin Password Reset Page
  router.get('/reset-password', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPrivateAdminHtml('reset-password.html', basePath));
  });

  // Authenticated Admin Dashboard (Server-side redirect if unauthenticated)
  router.get(['/', '/dashboard'], (req: Request, res: Response) => {
    const admin = getAuthenticatedAdmin(db, cfg, req);
    if (!admin) {
      res.redirect(302, `${basePath}/login`);
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPrivateAdminHtml('dashboard.html', basePath));
  });

  return router;
}

export function createAdminApiRouter(db: DbConnection, cfg: AppConfig) {
  const router = express.Router();

  const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 15,
    keyPrefix: 'admin-login',
    message: 'Too many login attempts from this IP address. Please wait 15 minutes.',
  });

  const resetRequestLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyPrefix: 'admin-reset-request',
    message: 'Too many password reset requests. Please try again later.',
  });

  /* ------------------------------------------------------------------------
     AUTH ENDPOINTS (Pre-Authentication)
     ------------------------------------------------------------------------ */
  router.post('/auth/login', loginLimiter, async (req: Request, res: Response) => {
    purgeExpiredAdminSessions(db);
    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const ip = getClientIp(req);

    if (!isValidEmail(email) || !password) {
      res.status(400).json({ error: 'Valid email address and password are required.' });
      return;
    }

    const user = db
      .prepare('SELECT * FROM admin_users WHERE LOWER(email) = LOWER(?) LIMIT 1')
      .get(email) as
      | {
          id: number;
          email: string;
          password_hash: string;
          role: string;
          active: number;
          failed_login_attempts: number;
          locked_until: string | null;
        }
      | undefined;

    if (!user || user.active !== 1) {
      // Constant-work dummy bcrypt compare to avoid timing-based email enumeration
      await bcrypt.compare(password, '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
      writeAuditLog(db, {
        adminEmail: email,
        action: 'ADMIN_LOGIN_FAILED',
        targetType: 'auth',
        details: { reason: 'invalid_credentials' },
        ipAddress: ip,
      });
      res.status(401).json({ error: 'Invalid email address or password.' });
      return;
    }

    if (user.locked_until) {
      const lockExpiry = Date.parse(user.locked_until.replace(' ', 'T') + 'Z');
      if (Number.isFinite(lockExpiry) && Date.now() < lockExpiry) {
        writeAuditLog(db, {
          adminUserId: user.id,
          adminEmail: user.email,
          action: 'ADMIN_LOGIN_LOCKED',
          targetType: 'auth',
          ipAddress: ip,
        });
        res.status(429).json({
          error: 'Account temporarily locked due to repeated failed sign-in attempts. Try again later.',
        });
        return;
      }
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      const nextFails = user.failed_login_attempts + 1;
      const shouldLock = nextFails >= MAX_FAILED_LOGINS;
      const lockUntil = shouldLock
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 19)
        : null;

      db.prepare(
        `
        UPDATE admin_users
        SET failed_login_attempts = ?, locked_until = ?, updated_at = datetime('now')
        WHERE id = ?
      `
      ).run(nextFails, lockUntil, user.id);

      writeAuditLog(db, {
        adminUserId: user.id,
        adminEmail: user.email,
        action: 'ADMIN_LOGIN_FAILED',
        targetType: 'auth',
        details: { attempts: nextFails, locked: shouldLock },
        ipAddress: ip,
      });

      res.status(401).json({ error: 'Invalid email address or password.' });
      return;
    }

    const rawSessionToken = generateSecureToken(32);
    const tokenHash = sha256Hex(rawSessionToken);
    const csrfToken = generateSecureToken(24);
    const expiresAt = new Date(Date.now() + cfg.adminSessionTtlMinutes * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);

    runInTransaction(db, () => {
      db.prepare(
        `
        UPDATE admin_users
        SET failed_login_attempts = 0, locked_until = NULL, last_login_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `
      ).run(user.id);

      db.prepare(
        `
        INSERT INTO admin_sessions (
          token_hash, csrf_token, admin_user_id, ip_address, user_agent, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        tokenHash,
        csrfToken,
        user.id,
        ip,
        String(req.headers['user-agent'] || '').slice(0, 250),
        expiresAt
      );

      writeAuditLog(db, {
        adminUserId: user.id,
        adminEmail: user.email,
        action: 'ADMIN_LOGIN_SUCCESS',
        targetType: 'auth',
        ipAddress: ip,
      });
    });

    setAdminSessionCookie(res, cfg, rawSessionToken);
    res.json({
      ok: true,
      admin: {
        email: user.email,
        role: user.role,
      },
      csrfToken,
    });
  });

  router.post('/auth/forgot-password', resetRequestLimiter, async (req: Request, res: Response) => {
    purgeExpiredAdminSessions(db);
    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || '').trim().toLowerCase();
    const ip = getClientIp(req);

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    if (!cfg.adminSecretPath) {
      res.status(503).json({ error: 'Private admin route is not configured.' });
      return;
    }

    // Refuse to simulate sending recovery emails if SMTP is not configured
    if (!isEmailConfigured(cfg)) {
      res.status(503).json({
        error:
          'Password recovery email delivery is not configured on this server. Configure SMTP environment variables to enable password reset emails.',
        missingVars: getMissingSmtpVars(cfg),
      });
      return;
    }

    const user = db
      .prepare('SELECT id, email, active FROM admin_users WHERE LOWER(email) = LOWER(?) LIMIT 1')
      .get(email) as { id: number; email: string; active: number } | undefined;

    if (user && user.active === 1) {
      const rawResetToken = generateSecureToken(32);
      const tokenHash = sha256Hex(rawResetToken);
      const expiresAt = new Date(Date.now() + cfg.adminPasswordResetTtlMinutes * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);

      runInTransaction(db, () => {
        // Invalidate previous unused tokens for this admin
        db.prepare(
          "UPDATE password_reset_tokens SET used_at = datetime('now') WHERE admin_user_id = ? AND used_at IS NULL"
        ).run(user.id);

        db.prepare(
          `
          INSERT INTO password_reset_tokens (token_hash, admin_user_id, expires_at)
          VALUES (?, ?, ?)
        `
        ).run(tokenHash, user.id, expiresAt);

        writeAuditLog(db, {
          adminUserId: user.id,
          adminEmail: user.email,
          action: 'ADMIN_PASSWORD_RESET_REQUESTED',
          targetType: 'auth',
          ipAddress: ip,
        });
      });

      const resetUrl = `${cfg.appUrl}/${cfg.adminSecretPath}/reset-password?token=${encodeURIComponent(rawResetToken)}`;
      try {
        await sendAdminPasswordResetEmail(
          cfg,
          user.email,
          resetUrl,
          cfg.adminPasswordResetTtlMinutes
        );
      } catch (err: unknown) {
        if (err instanceof EmailNotConfiguredError) {
          res.status(503).json({ error: err.message, missingVars: err.missingVars });
          return;
        }
        res.status(502).json({
          error: 'Email delivery provider failed to dispatch the password reset message.',
        });
        return;
      }
    }

    // Generic non-enumerating response regardless of whether the email exists
    res.json({
      ok: true,
      message:
        'If an active administrator account matches that email address, a single-use password reset link has been sent.',
    });
  });

  router.post('/auth/reset-password', resetRequestLimiter, async (req: Request, res: Response) => {
    purgeExpiredAdminSessions(db);
    const body = (req.body || {}) as Record<string, unknown>;
    const token = String(body.token || '').trim();
    const newPassword = String(body.newPassword || '');
    const ip = getClientIp(req);

    if (!token || token.length < 32) {
      res.status(400).json({ error: 'Invalid or missing password reset token.' });
      return;
    }

    const strength = isStrongPassword(newPassword);
    if (!strength.valid) {
      res.status(400).json({ error: strength.reason });
      return;
    }

    const tokenHash = sha256Hex(token);
    const tokenRow = db
      .prepare(
        `
        SELECT t.id AS token_id, t.admin_user_id, u.email, u.active
        FROM password_reset_tokens t
        JOIN admin_users u ON u.id = t.admin_user_id
        WHERE t.token_hash = ?
          AND t.used_at IS NULL
          AND t.expires_at > datetime('now')
        LIMIT 1
      `
      )
      .get(tokenHash) as
      | { token_id: number; admin_user_id: number; email: string; active: number }
      | undefined;

    if (!tokenRow || tokenRow.active !== 1) {
      res.status(400).json({ error: 'This password reset link is invalid, expired, or has already been used.' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    runInTransaction(db, () => {
      db.prepare(
        `
        UPDATE admin_users
        SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = datetime('now')
        WHERE id = ?
      `
      ).run(newHash, tokenRow.admin_user_id);

      // Single-use token invalidation + revoke all existing sessions
      db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(
        tokenRow.token_id
      );
      db.prepare('DELETE FROM admin_sessions WHERE admin_user_id = ?').run(tokenRow.admin_user_id);

      writeAuditLog(db, {
        adminUserId: tokenRow.admin_user_id,
        adminEmail: tokenRow.email,
        action: 'ADMIN_PASSWORD_RESET_COMPLETED',
        targetType: 'auth',
        ipAddress: ip,
      });
    });

    clearAdminSessionCookie(res, cfg);
    res.json({
      ok: true,
      message: 'Administrator password updated. All previous sessions have been revoked. You may now sign in.',
    });
  });

  /* ------------------------------------------------------------------------
     AUTHENTICATED ADMIN ROUTES (Require Valid Server Session + CSRF on writes)
     ------------------------------------------------------------------------ */
  router.use(requireAdminAuth(db, cfg));
  router.use(requireAdminCsrf);

  router.get('/auth/me', (req: AdminRequest, res: Response) => {
    const admin = req.admin!;
    res.json({
      admin: {
        id: admin.userId,
        email: admin.email,
        role: admin.role,
        expiresAt: admin.expiresAt,
      },
      csrfToken: admin.csrfToken,
    });
  });

  router.post('/auth/logout', (req: AdminRequest, res: Response) => {
    const admin = req.admin!;
    db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(admin.sessionId);
    writeAuditLog(db, {
      adminUserId: admin.userId,
      adminEmail: admin.email,
      action: 'ADMIN_LOGOUT',
      targetType: 'auth',
      ipAddress: getClientIp(req),
    });
    clearAdminSessionCookie(res, cfg);
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------------
     DASHBOARD OVERVIEW & REAL SYSTEM STATUS
     ------------------------------------------------------------------------ */
  router.get('/dashboard', (_req: AdminRequest, res: Response) => {
    const productStats = db
      .prepare(
        `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN in_stock = 1 AND stock_quantity > 0 THEN 1 ELSE 0 END) AS in_stock_count
        FROM products
      `
      )
      .get() as { total: number; in_stock_count: number | null };

    const categoryStats = db
      .prepare('SELECT COUNT(*) AS total FROM categories')
      .get() as { total: number };

    const sellerStats = db
      .prepare(
        `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_count
        FROM sellers
      `
      )
      .get() as { total: number; active_count: number | null };

    const orderStats = db
      .prepare(
        `
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_cents ELSE 0 END), 0) AS paid_revenue_cents
        FROM orders
      `
      )
      .get() as { total: number; paid_revenue_cents: number };

    const pendingPayments = db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM payments
        WHERE status IN ('Pending', 'Awaiting Verification')
      `
      )
      .get() as { total: number };

    const inquiryStats = db
      .prepare('SELECT COUNT(*) AS total FROM seller_inquiries')
      .get() as { total: number };

    const recentAudit = db
      .prepare(
        `
        SELECT id, admin_email, action, target_type, target_id, details_json, ip_address, created_at
        FROM audit_logs
        ORDER BY id DESC
        LIMIT 25
      `
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      stats: {
        totalProducts: Number(productStats.total || 0),
        inStockProducts: Number(productStats.in_stock_count || 0),
        outOfStockProducts:
          Number(productStats.total || 0) - Number(productStats.in_stock_count || 0),
        totalCategories: Number(categoryStats.total || 0),
        totalSellers: Number(sellerStats.total || 0),
        activeSellers: Number(sellerStats.active_count || 0),
        totalOrders: Number(orderStats.total || 0),
        paidRevenue: Number((Number(orderStats.paid_revenue_cents || 0) / 100).toFixed(2)),
        pendingPayments: Number(pendingPayments.total || 0),
        totalInquiries: Number(inquiryStats.total || 0),
      },
      integrations: {
        cybersourceConfigured: getMissingCyberSourceVars(cfg).length === 0,
        cybersourceMissingVars: getMissingCyberSourceVars(cfg),
        smtpConfigured: getMissingSmtpVars(cfg).length === 0,
        smtpMissingVars: getMissingSmtpVars(cfg),
        crypto: getCryptoVerifierStatus(cfg),
      },
      auditLogs: recentAudit,
    });
  });

  /* ------------------------------------------------------------------------
     CATEGORIES CRUD
     ------------------------------------------------------------------------ */
  router.get('/categories', (_req: AdminRequest, res: Response) => {
    const rows = db
      .prepare(
        `
        SELECT c.*, COUNT(p.id) AS product_count
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id
        GROUP BY c.id
        ORDER BY c.name ASC
      `
      )
      .all();
    res.json({ categories: rows });
  });

  router.post('/categories', (req: AdminRequest, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const slug = slugify(String(body.slug || name));
    const description = String(body.description || '').trim().slice(0, 500);

    if (name.length < 2 || name.length > 80 || !slug) {
      res.status(400).json({ error: 'Category name (2–80 characters) and valid slug are required.' });
      return;
    }

    try {
      const result = db
        .prepare('INSERT INTO categories (slug, name, description) VALUES (?, ?, ?)')
        .run(slug, name, description);

      writeAuditLog(db, {
        adminUserId: req.admin!.userId,
        adminEmail: req.admin!.email,
        action: 'CATEGORY_CREATED',
        targetType: 'category',
        targetId: String(result.lastInsertRowid),
        details: { name, slug },
        ipAddress: getClientIp(req),
      });

      const created = db
        .prepare('SELECT * FROM categories WHERE id = ?')
        .get(Number(result.lastInsertRowid));
      res.status(201).json({ category: created });
    } catch {
      res.status(409).json({ error: 'A category with that name or slug already exists.' });
    }
  });

  router.put('/categories/:id', (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid category ID.' });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim().slice(0, 500);

    if (name.length < 2 || name.length > 80) {
      res.status(400).json({ error: 'Category name must be between 2 and 80 characters.' });
      return;
    }

    try {
      const result = db
        .prepare(
          "UPDATE categories SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .run(name, description, id);

      if (result.changes === 0) {
        res.status(404).json({ error: 'Category not found.' });
        return;
      }

      writeAuditLog(db, {
        adminUserId: req.admin!.userId,
        adminEmail: req.admin!.email,
        action: 'CATEGORY_UPDATED',
        targetType: 'category',
        targetId: String(id),
        details: { name },
        ipAddress: getClientIp(req),
      });

      const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
      res.json({ category: updated });
    } catch {
      res.status(409).json({ error: 'Another category already uses that name.' });
    }
  });

  router.delete('/categories/:id', (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid category ID.' });
      return;
    }

    const assigned = db
      .prepare('SELECT COUNT(*) AS count FROM products WHERE category_id = ?')
      .get(id) as { count: number };

    if (assigned.count > 0) {
      res.status(409).json({
        error: `Cannot delete this category because ${assigned.count} product(s) are assigned to it.`,
      });
      return;
    }

    const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    writeAuditLog(db, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'CATEGORY_DELETED',
      targetType: 'category',
      targetId: String(id),
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------------
     SELLERS CRUD
     ------------------------------------------------------------------------ */
  router.get('/sellers', (_req: AdminRequest, res: Response) => {
    const rows = db
      .prepare(
        `
        SELECT s.*, COUNT(p.id) AS product_count
        FROM sellers s
        LEFT JOIN products p ON p.seller_id = s.id
        GROUP BY s.id
        ORDER BY s.username ASC
      `
      )
      .all();
    res.json({ sellers: rows });
  });

  router.post('/sellers', (req: AdminRequest, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const location = String(body.location || '').trim().slice(0, 120);
    const specialty = String(body.specialty || '').trim().slice(0, 120);
    const responseTime = String(body.responseTime || 'Within 24 hours').trim().slice(0, 80);

    if (username.length < 2 || username.length > 60 || !isValidEmail(email)) {
      res.status(400).json({ error: 'Seller username (2–60 chars) and valid email address are required.' });
      return;
    }

    try {
      const result = db
        .prepare(
          `
          INSERT INTO sellers (username, email, location, specialty, response_time, active)
          VALUES (?, ?, ?, ?, ?, 1)
        `
        )
        .run(username, email, location, specialty, responseTime);

      writeAuditLog(db, {
        adminUserId: req.admin!.userId,
        adminEmail: req.admin!.email,
        action: 'SELLER_CREATED',
        targetType: 'seller',
        targetId: String(result.lastInsertRowid),
        details: { username, email },
        ipAddress: getClientIp(req),
      });

      const created = db
        .prepare('SELECT * FROM sellers WHERE id = ?')
        .get(Number(result.lastInsertRowid));
      res.status(201).json({ seller: created });
    } catch {
      res.status(409).json({ error: 'A seller with that username or email already exists.' });
    }
  });

  router.put('/sellers/:id', (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid seller ID.' });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || '').trim().toLowerCase();
    const location = String(body.location || '').trim().slice(0, 120);
    const specialty = String(body.specialty || '').trim().slice(0, 120);
    const responseTime = String(body.responseTime || 'Within 24 hours').trim().slice(0, 80);
    const active = body.active === false || body.active === 0 ? 0 : 1;

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Valid seller email address is required.' });
      return;
    }

    try {
      const result = db
        .prepare(
          `
          UPDATE sellers
          SET email = ?, location = ?, specialty = ?, response_time = ?, active = ?, updated_at = datetime('now')
          WHERE id = ?
        `
        )
        .run(email, location, specialty, responseTime, active, id);

      if (result.changes === 0) {
        res.status(404).json({ error: 'Seller not found.' });
        return;
      }

      writeAuditLog(db, {
        adminUserId: req.admin!.userId,
        adminEmail: req.admin!.email,
        action: 'SELLER_UPDATED',
        targetType: 'seller',
        targetId: String(id),
        details: { email, active: active === 1 },
        ipAddress: getClientIp(req),
      });

      const updated = db.prepare('SELECT * FROM sellers WHERE id = ?').get(id);
      res.json({ seller: updated });
    } catch {
      res.status(409).json({ error: 'Another seller already uses that email address.' });
    }
  });

  /* ------------------------------------------------------------------------
     PRODUCTS CRUD
     ------------------------------------------------------------------------ */
  router.get('/products', (_req: AdminRequest, res: Response) => {
    const rows = db
      .prepare(
        `
        SELECT
          p.*,
          c.name AS category_name,
          c.slug AS category_slug,
          s.username AS seller_username
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN sellers s ON s.id = p.seller_id
        ORDER BY p.id DESC
      `
      )
      .all();
    res.json({ products: rows });
  });

  router.post('/products', (req: AdminRequest, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const priceCents = parseCents(body.price);
    const categoryId = parseInt(String(body.categoryId || ''), 10);
    const sellerId = parseInt(String(body.sellerId || ''), 10);
    const condition = String(body.condition || 'Used - Tested').trim().slice(0, 80);
    const stockQuantity = Math.max(0, parseInt(String(body.stockQuantity ?? '1'), 10) || 0);
    const inStock = body.inStock !== false && stockQuantity > 0 ? 1 : 0;
    const isDigital = body.isDigital === true ? 1 : 0;
    const availability =
      String(body.availability || '').trim() ||
      (inStock ? `In Stock (${stockQuantity} available)` : 'Out of Stock');
    const shippingCostCents = isDigital ? 0 : parseCents(body.shippingCost ?? 0) ?? 0;
    const shippingMethod = String(
      body.shippingMethod || (isDigital ? 'Instant Digital Delivery' : 'Standard Ground Shipping')
    )
      .trim()
      .slice(0, 120);
    const shippingHandling = String(body.shippingHandling || 'Ships within 2 business days')
      .trim()
      .slice(0, 120);
    const returnPolicy = String(body.returnPolicy || '14-day return policy')
      .trim()
      .slice(0, 160);
    const imageUrl = sanitizeImageUrl(
      String(body.imageUrl || ''),
      'assets/images/retro-keyboard.jpg'
    );
    const featured = body.featured === true ? 1 : 0;

    if (name.length < 3 || name.length > 160) {
      res.status(400).json({ error: 'Product name must be between 3 and 160 characters.' });
      return;
    }
    if (description.length < 10 || description.length > 5000) {
      res.status(400).json({ error: 'Product description must be at least 10 characters.' });
      return;
    }
    if (priceCents === null) {
      res.status(400).json({ error: 'A valid non-negative product price is required.' });
      return;
    }
    if (!Number.isInteger(categoryId) || !Number.isInteger(sellerId)) {
      res.status(400).json({ error: 'Valid category and seller selections are required.' });
      return;
    }

    try {
      const result = db
        .prepare(
          `
          INSERT INTO products (
            name, description, price_cents, category_id, seller_id,
            condition, availability, stock_quantity, in_stock, is_digital,
            shipping_cost_cents, shipping_method, shipping_handling, return_policy,
            image_url, gallery_json, specs_json, featured
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          name,
          description,
          priceCents,
          categoryId,
          sellerId,
          condition,
          availability,
          stockQuantity,
          inStock,
          isDigital,
          shippingCostCents,
          shippingMethod,
          shippingHandling,
          returnPolicy,
          imageUrl,
          JSON.stringify([{ src: imageUrl, caption: name }]),
          JSON.stringify({ Condition: condition, Fulfillment: shippingMethod }),
          featured
        );

      writeAuditLog(db, {
        adminUserId: req.admin!.userId,
        adminEmail: req.admin!.email,
        action: 'PRODUCT_CREATED',
        targetType: 'product',
        targetId: String(result.lastInsertRowid),
        details: { name, priceCents, stockQuantity },
        ipAddress: getClientIp(req),
      });

      const created = db
        .prepare('SELECT * FROM products WHERE id = ?')
        .get(Number(result.lastInsertRowid));
      res.status(201).json({ product: created });
    } catch {
      res.status(400).json({ error: 'Could not create product. Ensure category and seller exist.' });
    }
  });

  router.put('/products/:id', (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const priceCents = parseCents(body.price);
    const categoryId = parseInt(String(body.categoryId || ''), 10);
    const sellerId = parseInt(String(body.sellerId || ''), 10);
    const condition = String(body.condition || 'Used - Tested').trim().slice(0, 80);
    const stockQuantity = Math.max(0, parseInt(String(body.stockQuantity ?? '1'), 10) || 0);
    const inStock = body.inStock !== false && stockQuantity > 0 ? 1 : 0;
    const isDigital = body.isDigital === true ? 1 : 0;
    const availability =
      String(body.availability || '').trim() ||
      (inStock ? `In Stock (${stockQuantity} available)` : 'Out of Stock');
    const shippingCostCents = isDigital ? 0 : parseCents(body.shippingCost ?? 0) ?? 0;
    const imageUrl = sanitizeImageUrl(
      String(body.imageUrl || ''),
      'assets/images/retro-keyboard.jpg'
    );
    const featured = body.featured === true ? 1 : 0;

    if (name.length < 3 || description.length < 10 || priceCents === null) {
      res.status(400).json({ error: 'Valid name, description, and price are required.' });
      return;
    }

    const result = db
      .prepare(
        `
        UPDATE products
        SET
          name = ?, description = ?, price_cents = ?, category_id = ?, seller_id = ?,
          condition = ?, availability = ?, stock_quantity = ?, in_stock = ?, is_digital = ?,
          shipping_cost_cents = ?, image_url = ?, gallery_json = ?, featured = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `
      )
      .run(
        name,
        description,
        priceCents,
        categoryId,
        sellerId,
        condition,
        availability,
        stockQuantity,
        inStock,
        isDigital,
        shippingCostCents,
        imageUrl,
        JSON.stringify([{ src: imageUrl, caption: name }]),
        featured,
        id
      );

    if (result.changes === 0) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    writeAuditLog(db, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'PRODUCT_UPDATED',
      targetType: 'product',
      targetId: String(id),
      details: { name, priceCents, stockQuantity, inStock: inStock === 1 },
      ipAddress: getClientIp(req),
    });

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.json({ product: updated });
  });

  router.delete('/products/:id', (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }

    const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    writeAuditLog(db, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'PRODUCT_DELETED',
      targetType: 'product',
      targetId: String(id),
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------------
     ORDERS MANAGEMENT
     ------------------------------------------------------------------------ */
  router.get('/orders', (_req: AdminRequest, res: Response) => {
    const orders = db
      .prepare('SELECT * FROM orders ORDER BY id DESC')
      .all() as Array<Record<string, unknown>>;

    const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC');
    const enriched = orders.map((ord) => ({
      ...ord,
      items: itemStmt.all(Number(ord.id)),
    }));

    res.json({ orders: enriched });
  });

  router.patch('/orders/:id', (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid order ID.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const nextOrderStatus = String(body.orderStatus || existing.order_status).trim();
    const nextInternalNotes =
      typeof body.internalNotes === 'string'
        ? body.internalNotes.trim().slice(0, 1000)
        : String(existing.internal_notes || '');

    if (!ALLOWED_ORDER_STATUSES.includes(nextOrderStatus)) {
      res.status(400).json({ error: 'Invalid order status.' });
      return;
    }

    db.prepare(
      `
      UPDATE orders
      SET order_status = ?, internal_notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(nextOrderStatus, nextInternalNotes, id);

    writeAuditLog(db, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'ORDER_UPDATED',
      targetType: 'order',
      targetId: String(existing.order_number),
      details: {
        previousStatus: existing.order_status,
        orderStatus: nextOrderStatus,
      },
      ipAddress: getClientIp(req),
    });

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    res.json({ order: updated });
  });

  /* ------------------------------------------------------------------------
     PAYMENTS MANAGEMENT
     ------------------------------------------------------------------------ */
  router.get('/payments', (_req: AdminRequest, res: Response) => {
    const payments = db
      .prepare(
        `
        SELECT
          p.*,
          o.order_number,
          o.customer_name,
          o.customer_email,
          o.order_status
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        ORDER BY p.id DESC
      `
      )
      .all();
    res.json({ payments });
  });

  router.patch('/payments/:id', (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid payment ID.' });
      return;
    }

    const existing = db
      .prepare(
        `
        SELECT p.*, o.order_number
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        WHERE p.id = ?
        LIMIT 1
      `
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Payment record not found.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const nextStatus = String(body.status || '').trim();
    const reviewNote = String(body.reviewNote || '').trim().slice(0, 1000);

    if (!ALLOWED_PAYMENT_STATUSES.includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid payment status.' });
      return;
    }

    // Security invariant: CyberSource & Cryptocurrency payments MUST be verified cryptographically/on-chain
    // and cannot be manually forced to Paid by an admin click. Manual bank/money-order payments require a review reference.
    if (nextStatus === 'Paid' && String(existing.method) !== 'manual') {
      res.status(403).json({
        error:
          'Security Policy: CyberSource and Cryptocurrency payments can only be marked Paid through verified gateway webhooks or on-chain confirmation.',
      });
      return;
    }

    if (nextStatus === 'Paid' && String(existing.method) === 'manual' && reviewNote.length < 6) {
      res.status(400).json({
        error:
          'Marking a manual payment as Paid requires a verification note (e.g., bank wire reference or money order receipt number, min. 6 characters).',
      });
      return;
    }

    runInTransaction(db, () => {
      db.prepare(
        `
        UPDATE payments
        SET
          status = ?,
          review_note = ?,
          verified_at = CASE WHEN ? = 'Paid' THEN datetime('now') ELSE verified_at END,
          updated_at = datetime('now')
        WHERE id = ?
      `
      ).run(nextStatus, reviewNote, nextStatus, id);

      db.prepare(
        `
        UPDATE orders
        SET
          payment_status = ?,
          order_status = CASE WHEN ? = 'Paid' AND order_status = 'Pending' THEN 'Processing' ELSE order_status END,
          updated_at = datetime('now')
        WHERE id = ?
      `
      ).run(nextStatus, nextStatus, Number(existing.order_id));

      writeAuditLog(db, {
        adminUserId: req.admin!.userId,
        adminEmail: req.admin!.email,
        action: 'PAYMENT_REVIEWED',
        targetType: 'payment',
        targetId: String(existing.payment_ref),
        details: {
          orderNumber: existing.order_number,
          method: existing.method,
          previousStatus: existing.status,
          status: nextStatus,
          reviewNote,
        },
        ipAddress: getClientIp(req),
      });
    });

    const updated = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    res.json({ payment: updated });
  });

  /* ------------------------------------------------------------------------
     INQUIRIES & AUDIT LOGS
     ------------------------------------------------------------------------ */
  router.get('/inquiries', (_req: AdminRequest, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM seller_inquiries ORDER BY id DESC LIMIT 200')
      .all();
    res.json({ inquiries: rows });
  });

  router.get('/audit-logs', (_req: AdminRequest, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200')
      .all();
    res.json({ auditLogs: rows });
  });

  /* ------------------------------------------------------------------------
     WEBSITE SETTINGS & CRYPTO WALLET CONFIG
     ------------------------------------------------------------------------ */
  router.get('/settings', (_req: AdminRequest, res: Response) => {
    const row = db.prepare('SELECT * FROM website_settings WHERE id = 1').get();
    res.json({ settings: row });
  });

  router.put('/settings', (req: AdminRequest, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const siteName = String(body.siteName || 'RetroMarket').trim().slice(0, 80);
    const tagline = String(body.tagline || '').trim().slice(0, 180);
    const logoPath = sanitizeImageUrl(String(body.logoPath || ''), 'assets/icons/logo-mark.svg');
    const defaultCurrency = String(body.defaultCurrency || 'USD').trim().toUpperCase();
    const supportEmail = String(body.supportEmail || '').trim().toLowerCase();
    const sellerContactInfo = String(body.sellerContactInfo || '').trim().slice(0, 500);
    const guestCheckoutNotice = String(body.guestCheckoutNotice || '').trim().slice(0, 500);
    const btcWalletAddress = String(body.btcWalletAddress || '').trim().slice(0, 128);
    const ethWalletAddress = String(body.ethWalletAddress || '').trim().slice(0, 128);
    const usdtWalletAddress = String(body.usdtWalletAddress || '').trim().slice(0, 128);
    const usdtNetwork = String(body.usdtNetwork || 'ERC-20').trim().slice(0, 40);

    if (!siteName) {
      res.status(400).json({ error: 'Site Name is required.' });
      return;
    }
    if (!['USD', 'EUR', 'GBP', 'CAD'].includes(defaultCurrency)) {
      res.status(400).json({ error: 'Unsupported default currency.' });
      return;
    }
    if (supportEmail && !isValidEmail(supportEmail)) {
      res.status(400).json({ error: 'Support Email must be a valid email address.' });
      return;
    }

    db.prepare(
      `
      UPDATE website_settings
      SET
        site_name = ?,
        tagline = ?,
        logo_path = ?,
        default_currency = ?,
        support_email = ?,
        seller_contact_info = ?,
        guest_checkout_notice = ?,
        btc_wallet_address = ?,
        eth_wallet_address = ?,
        usdt_wallet_address = ?,
        usdt_network = ?,
        updated_at = datetime('now')
      WHERE id = 1
    `
    ).run(
      siteName,
      tagline,
      logoPath,
      defaultCurrency,
      supportEmail,
      sellerContactInfo,
      guestCheckoutNotice,
      btcWalletAddress,
      ethWalletAddress,
      usdtWalletAddress,
      usdtNetwork
    );

    writeAuditLog(db, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'SETTINGS_UPDATED',
      targetType: 'website_settings',
      targetId: '1',
      details: {
        siteName,
        defaultCurrency,
        btcConfigured: Boolean(btcWalletAddress),
        ethConfigured: Boolean(ethWalletAddress),
        usdtConfigured: Boolean(usdtWalletAddress),
      },
      ipAddress: getClientIp(req),
    });

    const updated = db.prepare('SELECT * FROM website_settings WHERE id = 1').get();
    res.json({ settings: updated });
  });

  return router;
}
