import express from 'express';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config.ts';
import { isSupabaseConfigured } from '../config.ts';
import { createPublicSupabaseClient } from '../supabase.ts';
import { buildStarterCatalogSnapshot } from '../catalog-seed.ts';
import {
  createRateLimiter,
  generateSecureToken,
  isValidEmail,
  isValidPhone,
  sanitizeImageUrl,
  sanitizeKeyValueMap,
  sanitizeSellerContact,
  sanitizeTelegramContact,
} from '../security.ts';
import {
  formatTelegramCryptoPaymentNotification,
  formatTelegramCyberSourceNotification,
  formatTelegramInquiryNotification,
  formatTelegramOrderNotification,
  notifyTelegramAsync,
} from '../telegram.ts';

function isMissingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === 'PGRST200' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache')
  );
}

function parseJsonObject(val: unknown): Record<string, unknown> {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonArray(val: unknown): Array<{ src: string; caption: string }> {
  let arr: unknown[] = [];
  if (Array.isArray(val)) {
    arr = val;
  } else if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
  }
  return arr
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const obj = item as Record<string, unknown>;
      return {
        src: String(obj.src || ''),
        caption: String(obj.caption || ''),
      };
    });
}

function formatPublicProduct(row: Record<string, unknown>) {
  const catRel = (row.categories || {}) as Record<string, unknown>;
  const sellerRel = (row.sellers || {}) as Record<string, unknown>;

  const gallery = parseJsonArray(row.gallery_json);
  const specs = sanitizeKeyValueMap(parseJsonObject(row.specs_json));
  const customAttributes = sanitizeKeyValueMap(parseJsonObject(row.custom_attributes_json));
  const productContactRaw = parseJsonObject(row.seller_contact_json);

  const mergedContact = sanitizeSellerContact({
    contactName: productContactRaw.contactName || sellerRel.username || '',
    email: productContactRaw.email || sellerRel.email || '',
    phone: productContactRaw.phone || sellerRel.phone || '',
    whatsapp: productContactRaw.whatsapp || sellerRel.whatsapp || '',
    telegram: productContactRaw.telegram || sellerRel.telegram || '',
    otherLabel: productContactRaw.otherLabel || '',
    otherUrl: productContactRaw.otherUrl || sellerRel.other_contact_url || '',
    notes: productContactRaw.notes || '',
  });

  const safeImg = sanitizeImageUrl(String(row.image_url || ''), 'assets/images/retro-keyboard.jpg');
  const shippingCents = Number(row.shipping_cost_cents || 0);
  const priceCents = Number(row.price_cents || 0);
  const stockQty = Number(row.stock_quantity || 0);
  const inStockFlag = row.in_stock === true || Number(row.in_stock) === 1;
  const isDigitalFlag = row.is_digital === true || Number(row.is_digital) === 1;
  const featuredFlag = row.featured === true || Number(row.featured) === 1;

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: String(row.description || ''),
    price: Number((priceCents / 100).toFixed(2)),
    priceCents,
    category: String(catRel.slug || ''),
    categoryId: Number(row.category_id),
    categoryName: String(catRel.name || ''),
    seller: String(sellerRel.username || ''),
    sellerId: Number(row.seller_id),
    condition: String(row.condition || ''),
    availability: String(row.availability || ''),
    stockQuantity: stockQty,
    inStock: inStockFlag && stockQty > 0,
    isDigital: isDigitalFlag,
    featured: featuredFlag,
    image: safeImg,
    images:
      gallery.length > 0
        ? gallery.map((g) => ({
            src: sanitizeImageUrl(g.src, safeImg),
            caption: String(g.caption || row.name || ''),
          }))
        : [{ src: safeImg, caption: String(row.name || '') }],
    specs,
    customAttributes,
    sellerContact: mergedContact,
    shippingCostCents: shippingCents,
    shipping: {
      method: String(row.shipping_method || 'Standard Ground Shipping'),
      cost: shippingCents === 0 ? 'Free ($0.00)' : `$${(shippingCents / 100).toFixed(2)}`,
      costAmount: Number((shippingCents / 100).toFixed(2)),
      handling: String(row.shipping_handling || 'Ships within 2 business days'),
      shipsFrom: String(row.shipping_from || sellerRel.location || ''),
      returns: String(row.return_policy || '14-day return policy'),
    },
    dateAdded: String(row.created_at || '').slice(0, 10),
    createdAt: String(row.created_at || ''),
  };
}

function formatPublicCryptoMethod(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    symbol: String(row.symbol || ''),
    network: String(row.network || ''),
    walletAddress: String(row.wallet_address || ''),
    qrCodeUrl: sanitizeImageUrl(String(row.qr_code_url || ''), ''),
    instructions: String(row.instructions || ''),
  };
}

const DEFAULT_SETTINGS = {
  siteName: 'RetroMarket',
  tagline: 'Classic Online Buying & Selling Directory',
  logoPath: 'assets/icons/logo-mark.svg',
  defaultCurrency: 'USD',
  supportEmail: '',
  sellerContactInfo: '',
  guestCheckoutNotice:
    'Shop and check out as a guest without creating a customer account. Save your Order Reference ID to track your order.',
};

export function createPublicApiRouter(cfg: AppConfig) {
  const router = express.Router();

  const checkoutLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyPrefix: 'checkout',
    message: 'Too many checkout requests. Please wait a few minutes before retrying.',
  });

  const lookupLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 60,
    keyPrefix: 'order-lookup',
    message: 'Too many order lookup requests. Please wait before trying again.',
  });

  const inquiryLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyPrefix: 'inquiry',
    message: 'Too many inquiries submitted. Please wait before sending another message.',
  });

  const PRODUCT_SELECT = `
    id, name, description, price_cents, category_id, seller_id,
    condition, availability, stock_quantity, in_stock, is_digital,
    shipping_cost_cents, shipping_method, shipping_handling, shipping_from,
    return_policy, image_url, gallery_json, specs_json,
    custom_attributes_json, seller_contact_json, featured, created_at,
    categories ( id, slug, name ),
    sellers ( id, username, email, location, phone, whatsapp, telegram, other_contact_url )
  `;

  /* ------------------------------------------------------------------------
     GET /api/storefront/bootstrap — Authoritative Public Storefront Data
     ------------------------------------------------------------------------ */
  router.get('/storefront/bootstrap', async (_req: Request, res: Response) => {
    const fallbackBootstrap = (configured: boolean) => {
      const starter = buildStarterCatalogSnapshot();
      res.json({
        supabaseConfigured: configured,
        settings: DEFAULT_SETTINGS,
        paymentCapabilities: {
          cybersource: {
            available: false,
            placeholderOnly: true,
            notice: 'CyberSource payment processing is currently unavailable.',
          },
          cryptocurrency: {
            manualVerificationOnly: true,
            methods: [],
          },
          manual: { configured: true },
        },
        categories: starter.categories,
        sellers: starter.sellers,
        products: starter.products,
        stats: {
          totalProducts: starter.products.length,
          totalCategories: starter.categories.length,
          activeSellers: starter.sellers.length,
        },
      });
    };

    if (!isSupabaseConfigured(cfg)) {
      fallbackBootstrap(false);
      return;
    }

    try {
      const supabase = createPublicSupabaseClient(cfg);

      const [settingsRes, categoriesRes, sellersRes, productsRes, cryptoRes] = await Promise.all([
        supabase.from('website_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('categories').select('id, slug, name, description').order('name', { ascending: true }),
        supabase
          .from('sellers')
          .select('id, username, location, specialty, response_time, telegram, active')
          .eq('active', true)
          .order('username', { ascending: true }),
        supabase.from('products').select(PRODUCT_SELECT).order('created_at', { ascending: false }).order('id', { ascending: false }),
        supabase
          .from('crypto_payment_methods')
          .select('id, name, symbol, network, wallet_address, qr_code_url, instructions, active, sort_order')
          .eq('active', true)
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true }),
      ]);

      if (productsRes.error && isMissingSchemaError(productsRes.error)) {
        console.warn(
          `[RetroMarket] Supabase tables not initialized (${productsRes.error.code || 'schema'}). Run supabase/schema.sql and supabase/seed.sql in Supabase SQL Editor.`
        );
        fallbackBootstrap(true);
        return;
      }

      const settingsRow = settingsRes.data as Record<string, unknown> | null;
      const productRows = (productsRes.data || []) as Record<string, unknown>[];
      const categoryRows = (categoriesRes.data || []) as Record<string, unknown>[];
      const sellerRows = (sellersRes.data || []) as Record<string, unknown>[];
      const cryptoRows = (cryptoRes.data || []) as Record<string, unknown>[];

      const catCounts = new Map<number, number>();
      const sellerCounts = new Map<number, number>();
      for (const p of productRows) {
        const cid = Number(p.category_id);
        const sid = Number(p.seller_id);
        catCounts.set(cid, (catCounts.get(cid) || 0) + 1);
        sellerCounts.set(sid, (sellerCounts.get(sid) || 0) + 1);
      }

      const products = productRows.map(formatPublicProduct);
      const categories = categoryRows.map((c) => ({
        id: Number(c.id),
        slug: String(c.slug || ''),
        name: String(c.name || ''),
        description: String(c.description || ''),
        productCount: catCounts.get(Number(c.id)) || 0,
      }));
      const sellers = sellerRows.map((s) => {
        const tg = sanitizeTelegramContact(s.telegram);
        return {
          id: Number(s.id),
          username: String(s.username || ''),
          location: String(s.location || ''),
          specialty: String(s.specialty || ''),
          responseTime: String(s.response_time || 'Within 24 hours'),
          telegram: tg.value,
          telegramUrl: tg.href,
          active: Boolean(s.active),
          productCount: sellerCounts.get(Number(s.id)) || 0,
        };
      });

      res.json({
        supabaseConfigured: true,
        settings: settingsRow
          ? {
              siteName: String(settingsRow.site_name || DEFAULT_SETTINGS.siteName),
              tagline: String(settingsRow.tagline || DEFAULT_SETTINGS.tagline),
              logoPath: sanitizeImageUrl(String(settingsRow.logo_path || ''), DEFAULT_SETTINGS.logoPath),
              defaultCurrency: String(settingsRow.default_currency || 'USD'),
              supportEmail: String(settingsRow.support_email || ''),
              sellerContactInfo: String(settingsRow.seller_contact_info || ''),
              guestCheckoutNotice: String(
                settingsRow.guest_checkout_notice || DEFAULT_SETTINGS.guestCheckoutNotice
              ),
            }
          : DEFAULT_SETTINGS,
        paymentCapabilities: {
          cybersource: {
            available: false,
            placeholderOnly: true,
            notice: 'CyberSource payment processing is currently unavailable.',
          },
          cryptocurrency: {
            manualVerificationOnly: true,
            methods: cryptoRows.map(formatPublicCryptoMethod),
          },
          manual: { configured: true },
        },
        categories,
        sellers,
        products,
        stats: {
          totalProducts: products.length,
          totalCategories: categories.length,
          activeSellers: sellers.length,
        },
      });
    } catch {
      res.status(503).json({ error: 'Unable to load storefront catalog from Supabase.' });
    }
  });

  /* ------------------------------------------------------------------------
     GET /api/products — Filtered, Sorted Public Catalog Query
     ------------------------------------------------------------------------ */
  router.get('/products', async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const categorySlug = String(req.query.cat || '').trim().toLowerCase();
    const sellerFilter = String(req.query.seller || '').trim().toLowerCase();
    const sort = String(req.query.sort || 'newest').trim();

    const applyFiltersAndSort = <T extends {
      id: number;
      name: string;
      description: string;
      seller: string;
      category: string;
      priceCents: number;
    }>(list: T[]) => {
      let result = list.slice();
      if (q) {
        result = result.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.seller.toLowerCase().includes(q) ||
            String(p.id) === q
        );
      }
      if (categorySlug && categorySlug !== 'all') {
        result = result.filter((p) => p.category.toLowerCase() === categorySlug);
      }
      if (sellerFilter) {
        result = result.filter((p) => p.seller.toLowerCase() === sellerFilter);
      }
      if (sort === 'price-asc') {
        result.sort((a, b) => a.priceCents - b.priceCents);
      } else if (sort === 'price-desc') {
        result.sort((a, b) => b.priceCents - a.priceCents);
      } else if (sort === 'name-asc') {
        result.sort((a, b) => a.name.localeCompare(b.name));
      }
      return result;
    };

    if (!isSupabaseConfigured(cfg)) {
      res.json({ products: applyFiltersAndSort(buildStarterCatalogSnapshot().products) });
      return;
    }

    try {
      const supabase = createPublicSupabaseClient(cfg);
      const { data, error } = await supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });

      if (error) {
        if (isMissingSchemaError(error)) {
          res.json({ products: applyFiltersAndSort(buildStarterCatalogSnapshot().products) });
          return;
        }
        res.status(503).json({ error: 'Could not query products from Supabase.' });
        return;
      }

      const products = applyFiltersAndSort(
        ((data || []) as Record<string, unknown>[]).map(formatPublicProduct)
      );
      res.json({ products });
    } catch {
      res.status(503).json({ error: 'Unable to fetch products from Supabase.' });
    }
  });

  /* ------------------------------------------------------------------------
     GET /api/products/:id — Single Product Detail + Related Products
     ------------------------------------------------------------------------ */
  router.get('/products/:id', async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }

    const sendStarterProduct = () => {
      const starter = buildStarterCatalogSnapshot();
      const found = starter.products.find((p) => p.id === id);
      if (!found) {
        res.status(404).json({ error: 'Product not found.' });
        return;
      }
      const related = starter.products
        .filter((p) => p.categoryId === found.categoryId && p.id !== found.id)
        .slice(0, 4);
      res.json({ product: found, related });
    };

    if (!isSupabaseConfigured(cfg)) {
      sendStarterProduct();
      return;
    }

    try {
      const supabase = createPublicSupabaseClient(cfg);
      const { data: row, error } = await supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (isMissingSchemaError(error)) {
          sendStarterProduct();
          return;
        }
        res.status(503).json({ error: 'Could not query product from Supabase.' });
        return;
      }

      if (!row) {
        res.status(404).json({ error: 'Product not found.' });
        return;
      }

      const product = formatPublicProduct(row as Record<string, unknown>);
      const { data: relatedRows } = await supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('category_id', product.categoryId)
        .neq('id', product.id)
        .order('created_at', { ascending: false })
        .limit(4);

      const related = ((relatedRows || []) as Record<string, unknown>[]).map(formatPublicProduct);
      res.json({ product, related });
    } catch {
      res.status(503).json({ error: 'Unable to fetch product from Supabase.' });
    }
  });

  /* ------------------------------------------------------------------------
     POST /api/orders — Authoritative Guest Order Creation via Supabase RPC
     ------------------------------------------------------------------------ */
  router.post('/orders', checkoutLimiter, async (req: Request, res: Response) => {
    if (!isSupabaseConfigured(cfg)) {
      res.status(503).json({ error: 'Supabase backend is not configured yet.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const country = String(body.country || '').trim();
    const city = String(body.city || '').trim();
    const shippingAddress = String(body.shippingAddress || '').trim();
    const notes = String(body.notes || '').trim().slice(0, 1000);
    const paymentMethod = String(body.paymentMethod || '').trim().toLowerCase();
    const rawItems = Array.isArray(body.items) ? body.items : [];

    const errors: string[] = [];
    if (fullName.length < 2 || fullName.length > 120) {
      errors.push('Full Name is required (2–120 characters).');
    }
    if (!isValidEmail(email)) {
      errors.push('A valid Email Address is required.');
    }
    if (!isValidPhone(phone)) {
      errors.push('A valid Phone Number is required (7–15 digits).');
    }
    if (!country || country.length > 80) {
      errors.push('Please select your Country.');
    }
    if (city.length < 2 || city.length > 80) {
      errors.push('City is required.');
    }
    if (!['cybersource', 'cryptocurrency', 'manual'].includes(paymentMethod)) {
      errors.push('Please select a valid payment method.');
    }
    if (rawItems.length === 0 || rawItems.length > 50) {
      errors.push('Your shopping cart is empty or contains too many line items.');
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors[0], errors });
      return;
    }

    const consolidated = new Map<number, number>();
    for (const entry of rawItems) {
      if (!entry || typeof entry !== 'object') {
        res.status(400).json({ error: 'Invalid cart item payload.' });
        return;
      }
      const itemId = parseInt(String((entry as Record<string, unknown>).id), 10);
      const qty = parseInt(String((entry as Record<string, unknown>).qty), 10);
      if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(qty) || qty <= 0 || qty > 99) {
        res.status(400).json({ error: 'Cart contains an invalid product ID or quantity.' });
        return;
      }
      consolidated.set(itemId, Math.min(99, (consolidated.get(itemId) || 0) + qty));
    }

    const itemsPayload = Array.from(consolidated.entries()).map(([id, qty]) => ({ id, qty }));
    const orderNumber = `RM-${new Date().getUTCFullYear()}-${generateSecureToken(4).toUpperCase()}`;
    const manualPayRef =
      paymentMethod === 'manual'
        ? `MAN-${new Date().getUTCFullYear()}-${generateSecureToken(5).toUpperCase()}`
        : '';

    try {
      const supabase = createPublicSupabaseClient(cfg);
      const { data, error } = await supabase.rpc('create_guest_order', {
        p_order_number: orderNumber,
        p_full_name: fullName,
        p_email: email,
        p_phone: phone,
        p_country: country,
        p_city: city,
        p_shipping_address: shippingAddress,
        p_notes: notes,
        p_payment_method: paymentMethod,
        p_items: itemsPayload,
        p_manual_payment_ref: manualPayRef,
      });

      if (error || !data) {
        res.status(400).json({ error: error?.message || 'Unable to complete checkout.' });
        return;
      }

      notifyTelegramAsync(
        cfg,
        formatTelegramOrderNotification(data as Record<string, unknown>),
        `order:${orderNumber}`
      );

      res.status(201).json({ order: data });
    } catch {
      res.status(500).json({ error: 'Unable to complete checkout at this time.' });
    }
  });

  /* ------------------------------------------------------------------------
     POST /api/orders/lookup — Guest Order Lookup (Order ID + Email)
     ------------------------------------------------------------------------ */
  router.post('/orders/lookup', lookupLimiter, async (req: Request, res: Response) => {
    if (!isSupabaseConfigured(cfg)) {
      res.status(503).json({ error: 'Supabase backend is not configured yet.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const orderNumber = String(body.orderNumber || '').trim();
    const email = String(body.email || '').trim().toLowerCase();

    if (!orderNumber || !isValidEmail(email)) {
      res.status(400).json({
        error: 'Both Order Reference ID and the Email Address used at checkout are required.',
      });
      return;
    }

    try {
      const supabase = createPublicSupabaseClient(cfg);
      const { data, error } = await supabase.rpc('lookup_guest_order', {
        p_order_number: orderNumber,
        p_email: email,
      });

      if (error || !data) {
        res.status(404).json({
          error: 'No order matched that Order Reference ID and Email Address.',
        });
        return;
      }

      res.json({ order: data });
    } catch {
      res.status(500).json({ error: 'Unable to look up order at this time.' });
    }
  });

  /* ------------------------------------------------------------------------
     POST /api/payments/crypto/submit — Manual Crypto Payment Submission
     Always marks order & payment "Pending Verification" until admin verifies.
     Zero blockchain APIs, zero automatic verification.
     ------------------------------------------------------------------------ */
  router.post('/payments/crypto/submit', checkoutLimiter, async (req: Request, res: Response) => {
    if (!isSupabaseConfigured(cfg)) {
      res.status(503).json({ error: 'Supabase backend is not configured yet.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const orderNumber = String(body.orderNumber || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const cryptoMethodId = parseInt(String(body.cryptoMethodId || ''), 10);
    const txReference = String(body.txReference || body.txHash || '').trim().slice(0, 160);
    const note = String(body.note || '').trim().slice(0, 500);

    if (!orderNumber || !isValidEmail(email)) {
      res.status(400).json({ error: 'Order Reference ID and checkout Email Address are required.' });
      return;
    }
    if (!Number.isInteger(cryptoMethodId) || cryptoMethodId <= 0) {
      res.status(400).json({ error: 'Please select a configured cryptocurrency payment option.' });
      return;
    }

    const paymentRef = `CRY-${new Date().getUTCFullYear()}-${generateSecureToken(5).toUpperCase()}`;

    try {
      const supabase = createPublicSupabaseClient(cfg);
      const { data, error } = await supabase.rpc('submit_manual_crypto_payment', {
        p_order_number: orderNumber,
        p_email: email,
        p_crypto_method_id: cryptoMethodId,
        p_payment_ref: paymentRef,
        p_tx_reference: txReference,
        p_note: note,
      });

      if (error || !data) {
        res.status(400).json({
          error: error?.message || 'Could not record cryptocurrency payment submission.',
        });
        return;
      }

      notifyTelegramAsync(
        cfg,
        formatTelegramCryptoPaymentNotification({
          paymentRef,
          orderNumber,
          email,
          cryptoMethodId,
          txReference,
          note,
          order: data as Record<string, unknown>,
        }),
        `crypto:${paymentRef}`
      );

      res.status(201).json({
        paymentRef,
        order: data,
        message:
          `Payment reference ${paymentRef} submitted. Order status is now Pending Verification until an administrator manually verifies receipt.`,
      });
    } catch {
      res.status(500).json({ error: 'Unable to submit cryptocurrency payment reference.' });
    }
  });

  /* ------------------------------------------------------------------------
     POST /api/payments/cybersource/notify — QA Notification (Masked Summary Only)
     Strictly rejects raw card numbers or CVN codes; forwards only order ref,
     server-verified amount, card brand, masked last-4 digits, and expiration.
     ------------------------------------------------------------------------ */
  router.post('/payments/cybersource/notify', checkoutLimiter, async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;

    if (
      body.cardNumber !== undefined ||
      body.pan !== undefined ||
      body.cvn !== undefined ||
      body.cvv !== undefined ||
      body.cvc !== undefined
    ) {
      res.status(400).json({
        error: 'Raw card numbers and CVN codes must never be transmitted to the server.',
      });
      return;
    }

    const orderNumber = String(body.orderNumber || '').trim().slice(0, 64);
    const email = String(body.email || '').trim().toLowerCase();
    const brand = String(body.brand || '').trim();
    const last4 = String(body.last4 || '').trim();
    const expiration = String(body.expiration || '').trim();
    const fallbackAmount = String(body.formattedAmount || '').trim().slice(0, 40);

    if (!orderNumber || !isValidEmail(email)) {
      res.status(400).json({ error: 'Valid Order Reference ID and Email Address are required.' });
      return;
    }
    if (!['Visa', 'Mastercard', 'Amex', 'Discover'].includes(brand)) {
      res.status(400).json({ error: 'Invalid card brand.' });
      return;
    }
    if (!/^\d{4}$/.test(last4)) {
      res.status(400).json({ error: 'Only masked last 4 digits are permitted.' });
      return;
    }
    if (!/^(0[1-9]|1[0-2])\/\d{4}$/.test(expiration)) {
      res.status(400).json({ error: 'Valid expiration date (MM/YYYY) is required.' });
      return;
    }

    let amountText = fallbackAmount || 'See order';

    if (isSupabaseConfigured(cfg)) {
      try {
        const supabase = createPublicSupabaseClient(cfg);
        const { data, error } = await supabase.rpc('lookup_guest_order', {
          p_order_number: orderNumber,
          p_email: email,
        });
        if (error || !data) {
          res.status(404).json({ error: 'Order not found for that Reference ID and Email Address.' });
          return;
        }
        const ord = data as Record<string, unknown>;
        if (ord.total !== undefined) {
          amountText = `$${Number(ord.total).toFixed(2)} ${String(ord.currency || 'USD')}`;
        }
      } catch {
        res.status(500).json({ error: 'Unable to verify order details.' });
        return;
      }
    }

    notifyTelegramAsync(
      cfg,
      formatTelegramCyberSourceNotification({
        orderNumber,
        customerEmail: email,
        amountText,
        brand,
        last4,
        expiration,
      }),
      `cybersource-test:${orderNumber}`
    );

    res.status(200).json({ ok: true });
  });

  /* ------------------------------------------------------------------------
     POST /api/inquiries — Guest Seller / Support Inquiry (Stored in Supabase)
     ------------------------------------------------------------------------ */
  router.post('/inquiries', inquiryLimiter, async (req: Request, res: Response) => {
    if (!isSupabaseConfigured(cfg)) {
      res.status(503).json({ error: 'Supabase backend is not configured yet.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const recipient = String(body.recipient || 'RetroMarket Support').trim().slice(0, 120);
    const productIdRaw = body.productId ? parseInt(String(body.productId), 10) : null;
    const productId = productIdRaw && Number.isInteger(productIdRaw) && productIdRaw > 0 ? productIdRaw : null;
    const orderNumber = String(body.orderNumber || '').trim().slice(0, 64);
    const guestName = String(body.guestName || '').trim().slice(0, 120);
    const guestEmail = String(body.guestEmail || '').trim().toLowerCase();
    const message = String(body.message || '').trim().slice(0, 2000);

    if (guestName.length < 2 || !isValidEmail(guestEmail) || message.length < 5) {
      res.status(400).json({
        error: 'Please enter your name, a valid email address, and an inquiry message (at least 5 characters).',
      });
      return;
    }

    const inquiryRef = `INQ-${new Date().getUTCFullYear()}-${generateSecureToken(4).toUpperCase()}`;

    try {
      const supabase = createPublicSupabaseClient(cfg);
      const { error } = await supabase.rpc('submit_seller_inquiry', {
        p_inquiry_ref: inquiryRef,
        p_recipient: recipient,
        p_product_id: productId,
        p_order_number: orderNumber,
        p_guest_name: guestName,
        p_guest_email: guestEmail,
        p_message: message,
      });

      if (error) {
        res.status(400).json({ error: error.message || 'Could not record inquiry.' });
        return;
      }

      notifyTelegramAsync(
        cfg,
        formatTelegramInquiryNotification({
          inquiryRef,
          recipient,
          productId,
          orderNumber,
          guestName,
          guestEmail,
          message,
        }),
        `inquiry:${inquiryRef}`
      );

      res.status(201).json({
        inquiryRef,
        message: `Inquiry ${inquiryRef} saved to RetroMarket for ${recipient}.`,
      });
    } catch {
      res.status(500).json({ error: 'Unable to submit inquiry at this time.' });
    }
  });

  return router;
}
