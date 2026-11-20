import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.ts';
import { getMissingSupabaseVars, isSupabaseConfigured } from '../config.ts';
import {
  createAuthedSupabaseClient,
  createPublicSupabaseClient,
  extractStorageObjectPath,
  getPublicStorageUrl,
} from '../supabase.ts';
import { ensureInitialAdminAccount, tryAutoAuthorizeAdminRow } from '../admin-bootstrap.ts';
import { seedCatalogWithClient } from '../catalog-seed.ts';
import type { AdminRequest } from '../security.ts';
import {
  clearAdminAuthCookies,
  createLoginBruteForceGuard,
  createRateLimiter,
  detectImageMagicBytes,
  generateSecureToken,
  getAuthenticatedAdmin,
  getClientIp,
  isValidEmail,
  isValidPhone,
  parseCents,
  requireAdminAuth,
  requireAdminCsrf,
  sanitizeExternalUrl,
  sanitizeImageUrl,
  sanitizeKeyValueMap,
  sanitizeSellerContact,
  sanitizeTelegramContact,
  sanitizeWhatsAppContact,
  setAdminAuthCookies,
  slugify,
  timingSafeEqualStr,
  writeAuditLog,
} from '../security.ts';

const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
const MAX_UPLOAD_FILES_PER_REQUEST = 10;
const MAX_PRODUCT_IMAGES = 12;
const ALLOWED_ORDER_STATUSES = ['Pending', 'Processing', 'Shipped', 'Completed', 'Cancelled'];
const ALLOWED_PAYMENT_STATUSES = [
  'Pending',
  'Pending Verification',
  'Paid',
  'Failed',
  'Cancelled',
  'Refunded',
];

function collectProductImageUrls(imageUrl: unknown, galleryJson: unknown): string[] {
  const urls: string[] = [];
  if (typeof imageUrl === 'string' && imageUrl.trim()) {
    urls.push(imageUrl.trim());
  }
  const gallery = Array.isArray(galleryJson)
    ? galleryJson
    : typeof galleryJson === 'string'
      ? (() => {
          try {
            const p = JSON.parse(galleryJson);
            return Array.isArray(p) ? p : [];
          } catch {
            return [];
          }
        })()
      : [];
  for (const item of gallery) {
    if (item && typeof item === 'object' && typeof (item as { src?: unknown }).src === 'string') {
      urls.push(String((item as { src: string }).src).trim());
    }
  }
  return urls;
}

async function cleanupOrphanedStorageUrls(
  supabase: SupabaseClient,
  cfg: AppConfig,
  candidateUrls: string[]
): Promise<void> {
  const objectPaths = new Set<string>();
  for (const url of candidateUrls) {
    const objPath = extractStorageObjectPath(cfg, url);
    if (objPath) objectPaths.add(objPath);
  }
  if (objectPaths.size === 0) return;

  // Check remaining references across products & crypto_payment_methods
  const [{ data: prodRows }, { data: cryptoRows }] = await Promise.all([
    supabase.from('products').select('image_url, gallery_json'),
    supabase.from('crypto_payment_methods').select('qr_code_url'),
  ]);

  const referenced = new Set<string>();
  for (const row of (prodRows || []) as Record<string, unknown>[]) {
    for (const u of collectProductImageUrls(row.image_url, row.gallery_json)) {
      const p = extractStorageObjectPath(cfg, u);
      if (p) referenced.add(p);
    }
  }
  for (const row of (cryptoRows || []) as Record<string, unknown>[]) {
    const p = extractStorageObjectPath(cfg, String(row.qr_code_url || ''));
    if (p) referenced.add(p);
  }

  const toDelete = Array.from(objectPaths).filter((p) => !referenced.has(p));
  if (toDelete.length > 0) {
    await supabase.storage.from(cfg.supabase.storageBucket).remove(toDelete).catch(() => {});
  }
}

function sanitizeGalleryInput(
  rawImages: unknown,
  fallbackUrl: string,
  productName: string
): Array<{ src: string; caption: string }> {
  const cleaned: Array<{ src: string; caption: string }> = [];
  const seen = new Set<string>();

  if (Array.isArray(rawImages)) {
    for (const entry of rawImages) {
      if (cleaned.length >= MAX_PRODUCT_IMAGES) break;
      const rawSrc =
        typeof entry === 'string'
          ? entry
          : entry && typeof entry === 'object'
            ? String((entry as Record<string, unknown>).src || '')
            : '';
      const safeSrc = sanitizeImageUrl(rawSrc, '');
      if (!safeSrc || seen.has(safeSrc)) continue;
      seen.add(safeSrc);
      const caption =
        entry && typeof entry === 'object'
          ? String((entry as Record<string, unknown>).caption || '').trim().slice(0, 140)
          : '';
      cleaned.push({ src: safeSrc, caption: caption || productName });
    }
  }

  if (cleaned.length === 0) {
    const safeFallback = sanitizeImageUrl(fallbackUrl, 'assets/images/retro-keyboard.jpg');
    cleaned.push({ src: safeFallback, caption: productName });
  }
  return cleaned;
}

function renderPrivateAdminHtml(fileName: string, adminBasePath: string): string {
  const filePath = path.resolve(process.cwd(), 'private', 'admin', fileName);
  const html = fs.readFileSync(filePath, 'utf8');
  return html.replace(/__ADMIN_BASE__/g, adminBasePath);
}

export function createPrivateAdminPageRouter(cfg: AppConfig) {
  const router = express.Router();
  const basePath = `/${cfg.adminSecretPath}`;

  router.get('/assets/admin.css', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.sendFile(path.resolve(process.cwd(), 'private', 'admin', 'admin.css'));
  });

  router.get('/assets/admin-login.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.sendFile(path.resolve(process.cwd(), 'private', 'admin', 'admin-login.js'));
  });

  router.get('/assets/admin-dashboard.js', async (req: Request, res: Response) => {
    const resolved = await getAuthenticatedAdmin(cfg, req, res);
    if (!resolved) {
      res.status(401).send('// Unauthorized');
      return;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.sendFile(path.resolve(process.cwd(), 'private', 'admin', 'admin-dashboard.js'));
  });

  router.get('/login', async (req: Request, res: Response) => {
    const resolved = await getAuthenticatedAdmin(cfg, req, res);
    if (resolved) {
      res.redirect(302, `${basePath}/`);
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPrivateAdminHtml('login.html', basePath));
  });

  router.get(['/', '/dashboard'], async (req: Request, res: Response) => {
    const resolved = await getAuthenticatedAdmin(cfg, req, res);
    if (!resolved) {
      res.redirect(302, `${basePath}/login`);
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPrivateAdminHtml('dashboard.html', basePath));
  });

  return router;
}

export function createAdminApiRouter(cfg: AppConfig) {
  const router = express.Router();

  const loginRequestFloodLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyPrefix: 'admin-login-flood',
    message: 'Too many login requests from this IP address. Please wait before trying again.',
  });

  const loginBruteForceGuard = createLoginBruteForceGuard({
    maxFailures: 5,
    windowMs: 15 * 60 * 1000,
    baseCooldownMs: 5 * 60 * 1000,
    maxCooldownMs: 30 * 60 * 1000,
  });

  function formatCooldown(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0 && secs > 0) return `${mins}m ${secs}s`;
    if (mins > 0) return `${mins} minute${mins === 1 ? '' : 's'}`;
    return `${secs} second${secs === 1 ? '' : 's'}`;
  }

  /* ------------------------------------------------------------------------
     SUPABASE AUTH ENDPOINTS (Pre-Authentication + Server-Side Rate Limiting)
     ------------------------------------------------------------------------ */
  router.post('/auth/login', loginRequestFloodLimiter, async (req: Request, res: Response) => {
    if (!isSupabaseConfigured(cfg)) {
      res.status(503).json({
        error: `Supabase is not configured. Missing: ${getMissingSupabaseVars(cfg).join(', ')}`,
      });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const ip = getClientIp(req);

    const guardCheck = loginBruteForceGuard.check(ip, email);
    if (!guardCheck.allowed) {
      res.setHeader('Retry-After', String(guardCheck.retryAfterSeconds));
      res.status(429).json({
        error: `Too many failed login attempts. Please wait ${formatCooldown(guardCheck.retryAfterSeconds)} before trying again.`,
        retryAfterSeconds: guardCheck.retryAfterSeconds,
      });
      return;
    }

    if (!isValidEmail(email) || !password) {
      res.status(400).json({ error: 'Valid email address and password are required.' });
      return;
    }

    const failAndRespond = (status: number, baseMessage: string) => {
      const outcome = loginBruteForceGuard.recordFailure(ip, email);
      if (outcome.locked) {
        res.setHeader('Retry-After', String(outcome.retryAfterSeconds));
        res.status(429).json({
          error: `Too many failed login attempts. Login is temporarily locked for ${formatCooldown(outcome.retryAfterSeconds)}.`,
          retryAfterSeconds: outcome.retryAfterSeconds,
        });
        return;
      }
      res.status(status).json({
        error: baseMessage,
        remainingAttempts: outcome.remainingAttempts,
      });
    };

    try {
      const publicClient = createPublicSupabaseClient(cfg);
      let { data: authData, error: authError } = await publicClient.auth.signInWithPassword({
        email,
        password,
      });

      // If sign-in failed and credentials match server-side ADMIN_EMAIL + ADMIN_PASSWORD,
      // attempt automatic initial Supabase Auth provisioning once and retry sign-in.
      const matchesBootstrapEnv =
        Boolean(cfg.adminBootstrap.email && cfg.adminBootstrap.password) &&
        timingSafeEqualStr(email, cfg.adminBootstrap.email) &&
        timingSafeEqualStr(password, cfg.adminBootstrap.password);

      if ((authError || !authData?.session) && matchesBootstrapEnv) {
        if (cfg.supabase.serviceRoleKey) {
          const boot = await ensureInitialAdminAccount(cfg, { syncPassword: true });
          if (boot.provisioned) {
            const retried = await publicClient.auth.signInWithPassword({ email, password });
            authData = retried.data;
            authError = retried.error;
          }
        } else if (
          authError &&
          !/email not confirmed/i.test(String(authError.message || '')) &&
          !/invalid api key/i.test(String(authError.message || ''))
        ) {
          // Without service role key, attempt one-time Supabase Auth signUp for the configured initial admin
          const { data: signUpData, error: signUpErr } = await publicClient.auth.signUp({
            email,
            password,
          });
          if (!signUpErr && signUpData?.session && signUpData?.user) {
            authData = { session: signUpData.session, user: signUpData.user } as typeof authData;
            authError = null;
          } else if (!signUpErr && signUpData?.user && !signUpData?.session) {
            res.status(403).json({
              error:
                'Initial administrator account was created in Supabase Auth, but email confirmation is enabled. Open Supabase Dashboard -> Authentication -> Users, confirm this user, and then sign in again.',
            });
            return;
          }
        }
      }

      if (authError || !authData?.session || !authData?.user) {
        const errMsg = String(authError?.message || '');
        const errCode = String((authError as { code?: string } | null)?.code || '');
        console.warn(
          `[RetroMarket Auth] Sign-in rejected for ${email} (${errCode || authError?.status || 'no_session'}): ${errMsg}`
        );

        if (errCode === 'email_not_confirmed' || /email not confirmed/i.test(errMsg)) {
          res.status(403).json({
            error:
              'This administrator account exists in Supabase Auth but its email is not confirmed. Open Supabase Dashboard -> Authentication -> Users and confirm the user.',
          });
          return;
        }

        if (/invalid api key/i.test(errMsg) || /api key/i.test(errMsg)) {
          res.status(503).json({
            error:
              'Supabase rejected the configured SUPABASE_ANON_KEY. Verify SUPABASE_URL and SUPABASE_ANON_KEY in your environment variables.',
          });
          return;
        }

        failAndRespond(401, 'Invalid administrator email address or password.');
        return;
      }

      const authedClient = createAuthedSupabaseClient(cfg, authData.session.access_token);
      let { data: adminRow, error: adminErr } = await authedClient
        .from('admin_users')
        .select('user_id, email, role, active')
        .eq('user_id', authData.user.id)
        .eq('active', true)
        .maybeSingle();

      // Detect missing schema (table public.admin_users not created yet)
      if (adminErr && (adminErr.code === '42P01' || adminErr.code === 'PGRST205')) {
        res.status(503).json({
          error:
            'Supabase table public.admin_users does not exist yet. Run supabase/schema.sql in your Supabase SQL Editor first.',
        });
        return;
      }

      // If Supabase Auth succeeded but admin_users row does not exist yet, attempt safe auto-authorization
      if (!adminRow) {
        adminRow = await tryAutoAuthorizeAdminRow(cfg, authedClient, authData.user);
      }

      if (!adminRow) {
        failAndRespond(
          403,
          'This Supabase Auth user is not authorized in public.admin_users. Add their User UID to public.admin_users in Supabase SQL Editor.'
        );
        return;
      }

      // Reset brute-force failure tracking on successful login
      loginBruteForceGuard.recordSuccess(ip, email);

      await authedClient
        .from('admin_users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('user_id', authData.user.id);

      const csrfToken = generateSecureToken(24);
      setAdminAuthCookies(res, cfg, {
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        csrfToken,
        expiresInSec: authData.session.expires_in,
      });

      await writeAuditLog(authedClient, {
        adminUserId: String(adminRow.user_id),
        adminEmail: String(adminRow.email),
        action: 'ADMIN_LOGIN_SUCCESS',
        targetType: 'auth',
        ipAddress: ip,
      });

      const expiresAt = authData.session.expires_at
        ? new Date(authData.session.expires_at * 1000).toISOString().replace('T', ' ').slice(0, 19)
        : 'Active Session';

      res.json({
        admin: {
          email: adminRow.email,
          role: adminRow.role,
          expiresAt,
        },
        csrfToken,
      });
    } catch (err) {
      console.error(
        '[RetroMarket Auth] Unexpected login error:',
        err instanceof Error ? err.message : 'unknown'
      );
      res.status(500).json({ error: 'Authentication service unavailable.' });
    }
  });

  /* ------------------------------------------------------------------------
     PROTECTED ADMIN ROUTES (Supabase JWT + admin_users RLS + CSRF)
     ------------------------------------------------------------------------ */
  router.use(requireAdminAuth(cfg));
  router.use(requireAdminCsrf);

  router.get('/auth/me', (req: AdminRequest, res: Response) => {
    const admin = req.admin!;
    res.json({
      admin: {
        email: admin.email,
        role: admin.role,
        expiresAt: admin.expiresAt,
      },
      csrfToken: admin.csrfToken,
    });
  });

  router.post('/auth/logout', async (req: AdminRequest, res: Response) => {
    const admin = req.admin!;
    await writeAuditLog(req.supabase!, {
      adminUserId: admin.userId,
      adminEmail: admin.email,
      action: 'ADMIN_LOGOUT',
      targetType: 'auth',
      ipAddress: getClientIp(req),
    });
    try {
      await req.supabase!.auth.signOut();
    } catch {
      // Ignore sign-out errors
    }
    clearAdminAuthCookies(res, cfg);
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------------
     DASHBOARD OVERVIEW
     ------------------------------------------------------------------------ */
  router.get('/dashboard', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const [
      prodsRes,
      catsRes,
      sellersRes,
      ordersRes,
      inquiriesRes,
      cryptoRes,
      auditRes,
    ] = await Promise.all([
      sb.from('products').select('id, in_stock, stock_quantity'),
      sb.from('categories').select('id', { count: 'exact', head: true }),
      sb.from('sellers').select('id, active'),
      sb.from('orders').select('id, payment_status, total_cents'),
      sb.from('seller_inquiries').select('id', { count: 'exact', head: true }),
      sb.from('crypto_payment_methods').select('id, active'),
      sb.from('audit_logs').select('*').order('id', { ascending: false }).limit(15),
    ]);

    const prodRows = (prodsRes.data || []) as Array<{ in_stock: boolean; stock_quantity: number }>;
    const sellerRows = (sellersRes.data || []) as Array<{ active: boolean }>;
    const orderRows = (ordersRes.data || []) as Array<{ payment_status: string; total_cents: number }>;
    const cryptoRows = (cryptoRes.data || []) as Array<{ active: boolean }>;

    const inStockProducts = prodRows.filter((p) => p.in_stock && p.stock_quantity > 0).length;
    const activeSellers = sellerRows.filter((s) => s.active).length;
    const pendingPayments = orderRows.filter(
      (o) => o.payment_status === 'Pending' || o.payment_status === 'Pending Verification'
    ).length;
    const paidRevenueCents = orderRows
      .filter((o) => o.payment_status === 'Paid')
      .reduce((acc, o) => acc + Number(o.total_cents || 0), 0);

    res.json({
      stats: {
        totalProducts: prodRows.length,
        inStockProducts,
        outOfStockProducts: prodRows.length - inStockProducts,
        totalCategories: catsRes.count || 0,
        totalSellers: sellerRows.length,
        activeSellers,
        totalOrders: orderRows.length,
        pendingPayments,
        paidRevenue: Number((paidRevenueCents / 100).toFixed(2)),
        totalInquiries: inquiriesRes.count || 0,
      },
      integrations: {
        supabaseConnected: true,
        storageBucket: cfg.supabase.storageBucket,
        cybersourceStatus: 'Frontend Placeholder (Unavailable)',
        activeCryptoMethods: cryptoRows.filter((c) => c.active).length,
      },
      auditLogs: auditRes.data || [],
    });
  });

  /* ------------------------------------------------------------------------
     CATEGORIES CRUD
     ------------------------------------------------------------------------ */
  router.get('/categories', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const [{ data: cats, error }, { data: prods }] = await Promise.all([
      sb.from('categories').select('*').order('name', { ascending: true }),
      sb.from('products').select('category_id'),
    ]);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const counts = new Map<number, number>();
    for (const p of (prods || []) as Array<{ category_id: number }>) {
      counts.set(Number(p.category_id), (counts.get(Number(p.category_id)) || 0) + 1);
    }
    res.json({
      categories: ((cats || []) as Record<string, unknown>[]).map((c) => ({
        ...c,
        product_count: counts.get(Number(c.id)) || 0,
      })),
    });
  });

  router.post('/categories', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const slug = slugify(String(body.slug || name));
    const description = String(body.description || '').trim().slice(0, 500);

    if (name.length < 2 || name.length > 80 || !slug) {
      res.status(400).json({ error: 'Category name (2–80 characters) is required.' });
      return;
    }

    const { data, error } = await sb
      .from('categories')
      .insert({ slug, name, description })
      .select('*')
      .single();

    if (error) {
      res.status(409).json({ error: 'A category with that name or slug already exists.' });
      return;
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'CATEGORY_CREATED',
      targetType: 'category',
      targetId: String(data.id),
      details: { name, slug },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ category: data });
  });

  router.put('/categories/:id', async (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid category ID.' });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim().slice(0, 500);

    if (name.length < 2 || name.length > 80) {
      res.status(400).json({ error: 'Category name (2–80 characters) is required.' });
      return;
    }

    const sb = req.supabase!;
    const { data, error } = await sb
      .from('categories')
      .update({ name, description })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      res.status(409).json({ error: 'Category name conflicts with an existing category.' });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'CATEGORY_UPDATED',
      targetType: 'category',
      targetId: String(id),
      details: { name },
      ipAddress: getClientIp(req),
    });

    res.json({ category: data });
  });

  router.delete('/categories/:id', async (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid category ID.' });
      return;
    }
    const sb = req.supabase!;
    const { count } = await sb
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id);

    if ((count || 0) > 0) {
      res.status(409).json({
        error: `Cannot delete category while ${count} product(s) are assigned to it. Reassign or delete those products first.`,
      });
      return;
    }

    const { error } = await sb.from('categories').delete().eq('id', id);
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await writeAuditLog(sb, {
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
  router.get('/sellers', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const [{ data: sellers, error }, { data: prods }] = await Promise.all([
      sb.from('sellers').select('*').order('username', { ascending: true }),
      sb.from('products').select('seller_id'),
    ]);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const counts = new Map<number, number>();
    for (const p of (prods || []) as Array<{ seller_id: number }>) {
      counts.set(Number(p.seller_id), (counts.get(Number(p.seller_id)) || 0) + 1);
    }
    res.json({
      sellers: ((sellers || []) as Record<string, unknown>[]).map((s) => ({
        ...s,
        product_count: counts.get(Number(s.id)) || 0,
      })),
    });
  });

  router.post('/sellers', async (req: AdminRequest, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const location = String(body.location || '').trim().slice(0, 120);
    const specialty = String(body.specialty || '').trim().slice(0, 120);
    const responseTime = String(body.responseTime || 'Within 24 hours').trim().slice(0, 80);
    const phoneRaw = String(body.phone || '').trim().slice(0, 40);
    const phone = phoneRaw && isValidPhone(phoneRaw) ? phoneRaw : '';
    const whatsapp = sanitizeWhatsAppContact(body.whatsapp).value;
    const telegram = sanitizeTelegramContact(body.telegram).value;
    const otherContactUrl = sanitizeExternalUrl(body.otherContactUrl);

    if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username)) {
      res.status(400).json({
        error: 'Seller username must be 3–50 alphanumeric, underscore, dot, or hyphen characters.',
      });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Valid seller email address is required.' });
      return;
    }

    const sb = req.supabase!;
    const { data, error } = await sb
      .from('sellers')
      .insert({
        username,
        email,
        location,
        specialty,
        response_time: responseTime,
        phone,
        whatsapp,
        telegram,
        other_contact_url: otherContactUrl,
        active: true,
      })
      .select('*')
      .single();

    if (error) {
      res.status(409).json({ error: 'A seller with that username or email already exists.' });
      return;
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'SELLER_CREATED',
      targetType: 'seller',
      targetId: String(data.id),
      details: { username, email },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ seller: data });
  });

  router.put('/sellers/:id', async (req: AdminRequest, res: Response) => {
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
    const phoneRaw = String(body.phone || '').trim().slice(0, 40);
    const phone = phoneRaw && isValidPhone(phoneRaw) ? phoneRaw : '';
    const whatsapp = sanitizeWhatsAppContact(body.whatsapp).value;
    const telegram = sanitizeTelegramContact(body.telegram).value;
    const otherContactUrl = sanitizeExternalUrl(body.otherContactUrl);
    const active = body.active !== false && body.active !== 0;

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Valid seller email address is required.' });
      return;
    }

    const sb = req.supabase!;
    const { data, error } = await sb
      .from('sellers')
      .update({
        email,
        location,
        specialty,
        response_time: responseTime,
        phone,
        whatsapp,
        telegram,
        other_contact_url: otherContactUrl,
        active,
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      res.status(409).json({ error: 'Another seller already uses that email address.' });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Seller not found.' });
      return;
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'SELLER_UPDATED',
      targetType: 'seller',
      targetId: String(id),
      details: { email, active },
      ipAddress: getClientIp(req),
    });

    res.json({ seller: data });
  });

  router.delete('/sellers/:id', async (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid seller ID.' });
      return;
    }

    const sb = req.supabase!;
    const { count } = await sb
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', id);

    if ((count || 0) > 0) {
      res.status(409).json({
        error: `Cannot delete seller while ${count} product(s) are assigned to them. Reassign or delete those products first.`,
      });
      return;
    }

    const { error } = await sb.from('sellers').delete().eq('id', id);
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'SELLER_DELETED',
      targetType: 'seller',
      targetId: String(id),
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------------
     ADMIN CATALOG INITIALIZATION (Idempotent Starter Catalog via Admin RLS)
     ------------------------------------------------------------------------ */
  router.post('/catalog/seed', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    try {
      const summary = await seedCatalogWithClient(sb);
      await writeAuditLog(sb, {
        adminUserId: req.admin!.userId,
        adminEmail: req.admin!.email,
        action: 'CATALOG_POPULATED',
        targetType: 'catalog',
        targetId: String(summary.productsInserted),
        details: { ...summary },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ ok: true, ...summary });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to populate catalog.',
      });
    }
  });

  /* ------------------------------------------------------------------------
     SUPABASE STORAGE IMAGE UPLOADS (Product Photos & Manual Crypto QR Codes)
     ------------------------------------------------------------------------ */
  const imageUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_IMAGE_BYTES,
      files: MAX_UPLOAD_FILES_PER_REQUEST,
    },
    fileFilter: (_req, file, cb) => {
      const allowedMimes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
      if (!allowedMimes.has(String(file.mimetype || '').toLowerCase())) {
        cb(new Error('Only JPG, PNG, and WebP image files are allowed.'));
        return;
      }
      cb(null, true);
    },
  });

  router.post('/uploads/images', (req: AdminRequest, res: Response) => {
    imageUploadMiddleware.array('images', MAX_UPLOAD_FILES_PER_REQUEST)(req, res, async (err: unknown) => {
      if (err) {
        const msg =
          err instanceof multer.MulterError
            ? err.code === 'LIMIT_FILE_SIZE'
              ? 'Each image must be 5 MB or smaller.'
              : err.code === 'LIMIT_FILE_COUNT'
                ? `You can upload up to ${MAX_UPLOAD_FILES_PER_REQUEST} images at once.`
                : err.message
            : err instanceof Error
              ? err.message
              : 'Image upload failed.';
        res.status(400).json({ error: msg });
        return;
      }

      const files = (req.files || []) as Express.Multer.File[];
      if (!Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: 'Please select at least one JPG, PNG, or WebP image file to upload.' });
        return;
      }

      const folderParam = String(req.query.folder || 'products').trim();
      const folder = folderParam === 'crypto-qr' ? 'crypto-qr' : 'products';
      const sb = req.supabase!;

      const uploadedPaths: string[] = [];
      const savedImages: Array<{
        src: string;
        objectPath: string;
        mimeType: string;
        size: number;
        caption: string;
      }> = [];

      try {
        for (const file of files) {
          const detected = detectImageMagicBytes(file.buffer);
          if (!detected) {
            throw new Error(
              `File "${file.originalname || 'image'}" is not a valid JPG, PNG, or WebP image.`
            );
          }

          const filename = `${folder === 'crypto-qr' ? 'qr' : 'prod'}-${Date.now()}-${generateSecureToken(8)}.${detected.ext}`;
          const objectPath = `${folder}/${filename}`;

          const { error: uploadErr } = await sb.storage
            .from(cfg.supabase.storageBucket)
            .upload(objectPath, file.buffer, {
              contentType: detected.mime,
              upsert: false,
            });

          if (uploadErr) {
            throw new Error(`Supabase Storage upload failed: ${uploadErr.message}`);
          }

          uploadedPaths.push(objectPath);
          const publicUrl = getPublicStorageUrl(cfg, objectPath);
          const baseCaption = path
            .basename(file.originalname || '', path.extname(file.originalname || ''))
            .replace(/[_-]+/g, ' ')
            .trim()
            .slice(0, 120);

          savedImages.push({
            src: publicUrl,
            objectPath,
            mimeType: detected.mime,
            size: file.size,
            caption: baseCaption || 'Product image',
          });
        }
      } catch (uploadFailure: unknown) {
        if (uploadedPaths.length > 0) {
          await sb.storage.from(cfg.supabase.storageBucket).remove(uploadedPaths).catch(() => {});
        }
        res.status(400).json({
          error:
            uploadFailure instanceof Error
              ? uploadFailure.message
              : 'Uploaded file failed validation or storage upload.',
        });
        return;
      }

      await writeAuditLog(sb, {
        adminUserId: req.admin!.userId,
        adminEmail: req.admin!.email,
        action: 'SUPABASE_STORAGE_UPLOAD',
        targetType: 'storage',
        targetId: String(savedImages.length),
        details: { bucket: cfg.supabase.storageBucket, paths: uploadedPaths },
        ipAddress: getClientIp(req),
      });

      res.status(201).json({ images: savedImages });
    });
  });

  router.delete('/uploads/images', async (req: AdminRequest, res: Response) => {
    const rawUrl = String((req.body as Record<string, unknown>)?.url || req.query.url || '').trim();
    const objectPath = extractStorageObjectPath(cfg, rawUrl);
    if (!objectPath) {
      res.status(400).json({ error: 'Invalid Supabase Storage image URL.' });
      return;
    }

    const sb = req.supabase!;
    await cleanupOrphanedStorageUrls(sb, cfg, [rawUrl]);
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------------
     PRODUCTS CRUD (Supabase DB + Supabase Storage Orphan Cleanup)
     ------------------------------------------------------------------------ */
  router.get('/products', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const { data, error } = await sb
      .from('products')
      .select('*, categories(name, slug), sellers(username)')
      .order('id', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const rows = ((data || []) as Record<string, unknown>[]).map((p) => {
      const cat = (p.categories || {}) as Record<string, unknown>;
      const sel = (p.sellers || {}) as Record<string, unknown>;
      return {
        ...p,
        category_name: String(cat.name || ''),
        category_slug: String(cat.slug || ''),
        seller_username: String(sel.username || ''),
      };
    });
    res.json({ products: rows });
  });

  router.post('/products', async (req: AdminRequest, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const priceCents = parseCents(body.price);
    const categoryId = parseInt(String(body.categoryId || ''), 10);
    const sellerId = parseInt(String(body.sellerId || ''), 10);
    const condition = String(body.condition || 'Used - Tested').trim().slice(0, 80);
    const stockQuantity = Math.max(0, parseInt(String(body.stockQuantity ?? '1'), 10) || 0);
    const inStock = body.inStock !== false && stockQuantity > 0;
    const isDigital = body.isDigital === true;
    const availability =
      String(body.availability || '').trim().slice(0, 80) ||
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
    const shippingFrom = String(body.shippingFrom || '').trim().slice(0, 120);
    const returnPolicy = String(body.returnPolicy || '14-day return policy').trim().slice(0, 160);
    const featured = body.featured === true;

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

    const gallery = sanitizeGalleryInput(body.images, String(body.imageUrl || ''), name);
    const primaryImageUrl = gallery[0].src;
    const specs = sanitizeKeyValueMap(body.specs, 30);
    const customAttributes = sanitizeKeyValueMap(body.customAttributes, 30);
    const sellerContact = sanitizeSellerContact(body.sellerContact);

    const sb = req.supabase!;
    const { data, error } = await sb
      .from('products')
      .insert({
        name,
        description,
        price_cents: priceCents,
        category_id: categoryId,
        seller_id: sellerId,
        condition,
        availability,
        stock_quantity: stockQuantity,
        in_stock: inStock,
        is_digital: isDigital,
        shipping_cost_cents: shippingCostCents,
        shipping_method: shippingMethod,
        shipping_handling: shippingHandling,
        shipping_from: shippingFrom,
        return_policy: returnPolicy,
        image_url: primaryImageUrl,
        gallery_json: gallery,
        specs_json: specs,
        custom_attributes_json: customAttributes,
        seller_contact_json: sellerContact,
        featured,
      })
      .select('*')
      .single();

    if (error) {
      res.status(400).json({ error: 'Could not create product. Ensure category and seller exist.' });
      return;
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'PRODUCT_CREATED',
      targetType: 'product',
      targetId: String(data.id),
      details: { name, priceCents, stockQuantity, imageCount: gallery.length },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ product: data });
  });

  router.put('/products/:id', async (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }

    const sb = req.supabase!;
    const { data: existing } = await sb
      .from('products')
      .select('image_url, gallery_json')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
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
    const inStock = body.inStock !== false && stockQuantity > 0;
    const isDigital = body.isDigital === true;
    const availability =
      String(body.availability || '').trim().slice(0, 80) ||
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
    const shippingFrom = String(body.shippingFrom || '').trim().slice(0, 120);
    const returnPolicy = String(body.returnPolicy || '14-day return policy').trim().slice(0, 160);
    const featured = body.featured === true;

    if (name.length < 3 || description.length < 10 || priceCents === null) {
      res.status(400).json({ error: 'Valid name, description, and price are required.' });
      return;
    }

    const gallery = sanitizeGalleryInput(body.images, String(body.imageUrl || ''), name);
    const primaryImageUrl = gallery[0].src;
    const specs = sanitizeKeyValueMap(body.specs, 30);
    const customAttributes = sanitizeKeyValueMap(body.customAttributes, 30);
    const sellerContact = sanitizeSellerContact(body.sellerContact);
    const previousUrls = collectProductImageUrls(existing.image_url, existing.gallery_json);

    const { data: updated, error } = await sb
      .from('products')
      .update({
        name,
        description,
        price_cents: priceCents,
        category_id: categoryId,
        seller_id: sellerId,
        condition,
        availability,
        stock_quantity: stockQuantity,
        in_stock: inStock,
        is_digital: isDigital,
        shipping_cost_cents: shippingCostCents,
        shipping_method: shippingMethod,
        shipping_handling: shippingHandling,
        shipping_from: shippingFrom,
        return_policy: returnPolicy,
        image_url: primaryImageUrl,
        gallery_json: gallery,
        specs_json: specs,
        custom_attributes_json: customAttributes,
        seller_contact_json: sellerContact,
        featured,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      res.status(400).json({ error: 'Could not update product.' });
      return;
    }

    const newUrlSet = new Set(gallery.map((g) => g.src));
    const removedUrls = previousUrls.filter((u) => !newUrlSet.has(u));
    await cleanupOrphanedStorageUrls(sb, cfg, removedUrls);

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'PRODUCT_UPDATED',
      targetType: 'product',
      targetId: String(id),
      details: { name, priceCents, stockQuantity, imageCount: gallery.length },
      ipAddress: getClientIp(req),
    });

    res.json({ product: updated });
  });

  router.delete('/products/:id', async (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }

    const sb = req.supabase!;
    const { data: existing } = await sb
      .from('products')
      .select('image_url, gallery_json')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const oldUrls = collectProductImageUrls(existing.image_url, existing.gallery_json);
    const { error } = await sb.from('products').delete().eq('id', id);
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await cleanupOrphanedStorageUrls(sb, cfg, oldUrls);

    await writeAuditLog(sb, {
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
     MANUAL CRYPTOCURRENCY PAYMENT METHODS CRUD
     (Name, Symbol, Network, Wallet Address, QR Code URL, Payment Instructions)
     ------------------------------------------------------------------------ */
  router.get('/crypto-methods', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const { data, error } = await sb
      .from('crypto_payment_methods')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ cryptoMethods: data || [] });
  });

  router.post('/crypto-methods', async (req: AdminRequest, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name || '').trim().slice(0, 80);
    const symbol = String(body.symbol || '').trim().toUpperCase().slice(0, 20);
    const network = String(body.network || '').trim().slice(0, 80);
    const walletAddress = String(body.walletAddress || '').trim().slice(0, 220);
    const qrCodeUrl = sanitizeImageUrl(String(body.qrCodeUrl || ''), '');
    const instructions = String(body.instructions || '').trim().slice(0, 1500);
    const active = body.active !== false;
    const sortOrder = parseInt(String(body.sortOrder ?? '0'), 10) || 0;

    if (!name || !symbol || !network || !walletAddress) {
      res.status(400).json({
        error: 'Cryptocurrency name, symbol, network, and wallet address are required.',
      });
      return;
    }

    const sb = req.supabase!;
    const { data, error } = await sb
      .from('crypto_payment_methods')
      .insert({
        name,
        symbol,
        network,
        wallet_address: walletAddress,
        qr_code_url: qrCodeUrl,
        instructions,
        active,
        sort_order: sortOrder,
      })
      .select('*')
      .single();

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'CRYPTO_METHOD_CREATED',
      targetType: 'crypto_payment_method',
      targetId: String(data.id),
      details: { name, symbol, network },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ cryptoMethod: data });
  });

  router.put('/crypto-methods/:id', async (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid cryptocurrency method ID.' });
      return;
    }

    const sb = req.supabase!;
    const { data: existing } = await sb
      .from('crypto_payment_methods')
      .select('qr_code_url')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      res.status(404).json({ error: 'Cryptocurrency payment method not found.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name || '').trim().slice(0, 80);
    const symbol = String(body.symbol || '').trim().toUpperCase().slice(0, 20);
    const network = String(body.network || '').trim().slice(0, 80);
    const walletAddress = String(body.walletAddress || '').trim().slice(0, 220);
    const qrCodeUrl = sanitizeImageUrl(String(body.qrCodeUrl || ''), '');
    const instructions = String(body.instructions || '').trim().slice(0, 1500);
    const active = body.active !== false;
    const sortOrder = parseInt(String(body.sortOrder ?? '0'), 10) || 0;

    if (!name || !symbol || !network || !walletAddress) {
      res.status(400).json({
        error: 'Cryptocurrency name, symbol, network, and wallet address are required.',
      });
      return;
    }

    const { data, error } = await sb
      .from('crypto_payment_methods')
      .update({
        name,
        symbol,
        network,
        wallet_address: walletAddress,
        qr_code_url: qrCodeUrl,
        instructions,
        active,
        sort_order: sortOrder,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (existing.qr_code_url && existing.qr_code_url !== qrCodeUrl) {
      await cleanupOrphanedStorageUrls(sb, cfg, [String(existing.qr_code_url)]);
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'CRYPTO_METHOD_UPDATED',
      targetType: 'crypto_payment_method',
      targetId: String(id),
      details: { name, symbol, network, active },
      ipAddress: getClientIp(req),
    });

    res.json({ cryptoMethod: data });
  });

  router.delete('/crypto-methods/:id', async (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid cryptocurrency method ID.' });
      return;
    }

    const sb = req.supabase!;
    const { data: existing } = await sb
      .from('crypto_payment_methods')
      .select('qr_code_url')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      res.status(404).json({ error: 'Cryptocurrency payment method not found.' });
      return;
    }

    const { error } = await sb.from('crypto_payment_methods').delete().eq('id', id);
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (existing.qr_code_url) {
      await cleanupOrphanedStorageUrls(sb, cfg, [String(existing.qr_code_url)]);
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'CRYPTO_METHOD_DELETED',
      targetType: 'crypto_payment_method',
      targetId: String(id),
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------------
     ORDERS MANAGEMENT
     ------------------------------------------------------------------------ */
  router.get('/orders', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const { data, error } = await sb
      .from('orders')
      .select('*, order_items(*), payments(*)')
      .order('id', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const enriched = ((data || []) as Record<string, unknown>[]).map((ord) => ({
      ...ord,
      items: Array.isArray(ord.order_items) ? ord.order_items : [],
      payments: Array.isArray(ord.payments) ? ord.payments : [],
    }));
    res.json({ orders: enriched });
  });

  router.patch('/orders/:id', async (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid order ID.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const orderStatus = String(body.orderStatus || '').trim();
    const internalNotes = String(body.internalNotes ?? '').trim().slice(0, 1500);
    const paymentStatus = body.paymentStatus ? String(body.paymentStatus).trim() : '';

    if (!ALLOWED_ORDER_STATUSES.includes(orderStatus)) {
      res.status(400).json({ error: `Order status must be one of: ${ALLOWED_ORDER_STATUSES.join(', ')}.` });
      return;
    }
    if (paymentStatus && !ALLOWED_PAYMENT_STATUSES.includes(paymentStatus)) {
      res.status(400).json({
        error: `Payment status must be one of: ${ALLOWED_PAYMENT_STATUSES.join(', ')}.`,
      });
      return;
    }

    const sb = req.supabase!;
    const patch: Record<string, unknown> = {
      order_status: orderStatus,
      internal_notes: internalNotes,
    };
    if (paymentStatus) {
      patch.payment_status = paymentStatus;
    }

    const { data, error } = await sb
      .from('orders')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'ORDER_STATUS_UPDATED',
      targetType: 'order',
      targetId: String(data.order_number),
      details: { orderStatus, paymentStatus: paymentStatus || data.payment_status },
      ipAddress: getClientIp(req),
    });

    res.json({ order: data });
  });

  /* ------------------------------------------------------------------------
     PAYMENTS REVIEW & MANUAL VERIFICATION (Crypto & Manual Seller Payments)
     ------------------------------------------------------------------------ */
  router.get('/payments', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const { data, error } = await sb
      .from('payments')
      .select('*, orders(order_number, customer_name, customer_email)')
      .order('id', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const rows = ((data || []) as Record<string, unknown>[]).map((p) => {
      const ord = (p.orders || {}) as Record<string, unknown>;
      return {
        ...p,
        order_number: String(ord.order_number || ''),
        customer_name: String(ord.customer_name || ''),
        customer_email: String(ord.customer_email || ''),
      };
    });
    res.json({ payments: rows });
  });

  router.patch('/payments/:id', async (req: AdminRequest, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid payment ID.' });
      return;
    }

    const sb = req.supabase!;
    const { data: payment } = await sb
      .from('payments')
      .select('id, payment_ref, order_id, method, status')
      .eq('id', id)
      .maybeSingle();

    if (!payment) {
      res.status(404).json({ error: 'Payment record not found.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const status = String(body.status || '').trim();
    const reviewNote = String(body.reviewNote || '').trim().slice(0, 1000);

    if (!ALLOWED_PAYMENT_STATUSES.includes(status)) {
      res.status(400).json({
        error: `Payment status must be one of: ${ALLOWED_PAYMENT_STATUSES.join(', ')}.`,
      });
      return;
    }

    if (status === 'Paid' && payment.method === 'cybersource') {
      res.status(400).json({
        error: 'CyberSource processing is unavailable and cannot be marked Paid.',
      });
      return;
    }

    if (status === 'Paid' && reviewNote.length < 5) {
      res.status(400).json({
        error:
          'Marking a cryptocurrency or manual payment as Paid requires a verification note (at least 5 characters, e.g. wallet receipt or transfer reference).',
      });
      return;
    }

    const { data: updated, error } = await sb
      .from('payments')
      .update({
        status,
        review_note: reviewNote,
        verified_at: status === 'Paid' ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await sb
      .from('orders')
      .update({ payment_status: status })
      .eq('id', payment.order_id);

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'PAYMENT_MANUALLY_VERIFIED',
      targetType: 'payment',
      targetId: String(payment.payment_ref),
      details: { method: payment.method, previousStatus: payment.status, status, reviewNote },
      ipAddress: getClientIp(req),
    });

    res.json({ payment: updated });
  });

  /* ------------------------------------------------------------------------
     INQUIRIES, AUDIT LOGS & WEBSITE SETTINGS
     ------------------------------------------------------------------------ */
  router.get('/inquiries', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const { data, error } = await sb
      .from('seller_inquiries')
      .select('*')
      .order('id', { ascending: false })
      .limit(200);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ inquiries: data || [] });
  });

  router.get('/audit-logs', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const { data, error } = await sb
      .from('audit_logs')
      .select('*')
      .order('id', { ascending: false })
      .limit(200);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ auditLogs: data || [] });
  });

  router.get('/settings', async (req: AdminRequest, res: Response) => {
    const sb = req.supabase!;
    const { data, error } = await sb
      .from('website_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ settings: data });
  });

  router.put('/settings', async (req: AdminRequest, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const siteName = String(body.siteName || 'RetroMarket').trim().slice(0, 80);
    const tagline = String(body.tagline || '').trim().slice(0, 160);
    const logoPath = sanitizeImageUrl(String(body.logoPath || ''), 'assets/icons/logo-mark.svg');
    const defaultCurrency = String(body.defaultCurrency || 'USD').trim().toUpperCase();
    const supportEmailRaw = String(body.supportEmail || '').trim().toLowerCase();
    const sellerContactInfo = String(body.sellerContactInfo || '').trim().slice(0, 500);
    const guestCheckoutNotice = String(body.guestCheckoutNotice || '').trim().slice(0, 500);

    if (!['USD', 'EUR', 'GBP', 'CAD'].includes(defaultCurrency)) {
      res.status(400).json({ error: 'Currency must be USD, EUR, GBP, or CAD.' });
      return;
    }
    if (supportEmailRaw && !isValidEmail(supportEmailRaw)) {
      res.status(400).json({ error: 'Support email must be a valid email address or left blank.' });
      return;
    }

    const sb = req.supabase!;
    const { data, error } = await sb
      .from('website_settings')
      .upsert(
        {
          id: 1,
          site_name: siteName || 'RetroMarket',
          tagline,
          logo_path: logoPath,
          default_currency: defaultCurrency,
          support_email: supportEmailRaw,
          seller_contact_info: sellerContactInfo,
          guest_checkout_notice: guestCheckoutNotice,
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single();

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await writeAuditLog(sb, {
      adminUserId: req.admin!.userId,
      adminEmail: req.admin!.email,
      action: 'SETTINGS_UPDATED',
      targetType: 'settings',
      targetId: '1',
      details: { siteName, defaultCurrency },
      ipAddress: getClientIp(req),
    });

    res.json({ settings: data });
  });

  return router;
}
