import express from 'express';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config.ts';
import { getCryptoVerifierStatus, getMissingCyberSourceVars } from '../config.ts';
import type { DbConnection } from '../db.ts';
import { runInTransaction } from '../db.ts';
import {
  createRateLimiter,
  generateSecureToken,
  isValidEmail,
  isValidPhone,
  sanitizeImageUrl,
} from '../security.ts';
import { sendSellerInquiryEmail, isEmailConfigured } from '../mailer.ts';
import {
  createCyberSourceCheckoutSession,
  processCyberSourceNotification,
} from '../payments/cybersource.ts';
import {
  createCryptoInvoice,
  getConfiguredCryptoWallets,
  processCryptoWebhook,
  submitCryptoTransactionHash,
} from '../payments/crypto.ts';

function formatPublicProduct(row: Record<string, unknown>) {
  let gallery: Array<{ src: string; caption: string }> = [];
  let specs: Record<string, string> = {};
  try {
    const parsedGallery = JSON.parse(String(row.gallery_json || '[]'));
    if (Array.isArray(parsedGallery)) gallery = parsedGallery;
  } catch {
    gallery = [];
  }
  try {
    const parsedSpecs = JSON.parse(String(row.specs_json || '{}'));
    if (parsedSpecs && typeof parsedSpecs === 'object') specs = parsedSpecs;
  } catch {
    specs = {};
  }

  const safeImg = sanitizeImageUrl(String(row.image_url || ''), 'assets/images/retro-keyboard.jpg');
  const shippingCents = Number(row.shipping_cost_cents || 0);
  const priceCents = Number(row.price_cents || 0);

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: String(row.description || ''),
    price: Number((priceCents / 100).toFixed(2)),
    priceCents,
    category: String(row.category_slug || ''),
    categoryId: Number(row.category_id),
    categoryName: String(row.category_name || ''),
    seller: String(row.seller_username || ''),
    sellerId: Number(row.seller_id),
    condition: String(row.condition || ''),
    availability: String(row.availability || ''),
    stockQuantity: Number(row.stock_quantity || 0),
    inStock: Number(row.in_stock) === 1 && Number(row.stock_quantity || 0) > 0,
    isDigital: Number(row.is_digital) === 1,
    featured: Number(row.featured) === 1,
    image: safeImg,
    images:
      gallery.length > 0
        ? gallery.map((g) => ({
            src: sanitizeImageUrl(g.src, safeImg),
            caption: String(g.caption || row.name || ''),
          }))
        : [{ src: safeImg, caption: String(row.name || '') }],
    specs,
    shippingCostCents: shippingCents,
    shipping: {
      method: String(row.shipping_method || 'Standard Ground Shipping'),
      cost: shippingCents === 0 ? 'Free ($0.00)' : `$${(shippingCents / 100).toFixed(2)}`,
      costAmount: Number((shippingCents / 100).toFixed(2)),
      handling: String(row.shipping_handling || 'Ships within 2 business days'),
      shipsFrom: String(row.shipping_from || row.seller_location || ''),
      returns: String(row.return_policy || '14-day return policy'),
    },
    dateAdded: String(row.created_at || '').slice(0, 10),
    createdAt: String(row.created_at || ''),
  };
}

function getPaymentMethodLabel(code: string): string {
  if (code === 'cybersource') return 'CyberSource';
  if (code === 'cryptocurrency') return 'Cryptocurrency';
  return 'Contact Seller / Manual Payment';
}

function formatPublicOrder(
  db: DbConnection,
  orderRow: Record<string, unknown>
) {
  const orderId = Number(orderRow.id);
  const items = db
    .prepare(
      `
      SELECT product_id, product_name, seller_username, unit_price_cents, quantity, line_total_cents, line_shipping_cents
      FROM order_items
      WHERE order_id = ?
      ORDER BY id ASC
    `
    )
    .all(orderId) as Array<Record<string, unknown>>;

  const payments = db
    .prepare(
      `
      SELECT payment_ref, method, provider, currency, expected_amount_cents,
             crypto_currency, crypto_expected_amount, crypto_wallet_address, crypto_network,
             provider_transaction_id, tx_hash, confirmations, required_confirmations,
             status, expires_at, verified_at, created_at
      FROM payments
      WHERE order_id = ?
      ORDER BY id DESC
    `
    )
    .all(orderId) as Array<Record<string, unknown>>;

  return {
    orderId: String(orderRow.order_number),
    orderNumber: String(orderRow.order_number),
    customer: {
      fullName: String(orderRow.customer_name),
      email: String(orderRow.customer_email),
      phone: String(orderRow.customer_phone),
      country: String(orderRow.customer_country),
      city: String(orderRow.customer_city),
      shippingAddress: String(orderRow.shipping_address || ''),
      requiresShipping: Number(orderRow.requires_shipping) === 1,
      notes: String(orderRow.customer_notes || ''),
    },
    products: items.map((it) => ({
      id: it.product_id ? Number(it.product_id) : null,
      name: String(it.product_name),
      seller: String(it.seller_username),
      unitPrice: Number((Number(it.unit_price_cents) / 100).toFixed(2)),
      qty: Number(it.quantity),
      lineTotal: Number((Number(it.line_total_cents) / 100).toFixed(2)),
    })),
    subtotal: Number((Number(orderRow.subtotal_cents) / 100).toFixed(2)),
    shipping: Number((Number(orderRow.shipping_cents) / 100).toFixed(2)),
    total: Number((Number(orderRow.total_cents) / 100).toFixed(2)),
    currency: String(orderRow.currency || 'USD'),
    paymentMethod: String(orderRow.payment_method),
    paymentMethodLabel: getPaymentMethodLabel(String(orderRow.payment_method)),
    paymentStatus: String(orderRow.payment_status),
    orderStatus: String(orderRow.order_status),
    createdAt: String(orderRow.created_at),
    updatedAt: String(orderRow.updated_at),
    payments: payments.map((p) => ({
      paymentRef: String(p.payment_ref),
      method: String(p.method),
      provider: String(p.provider || ''),
      currency: String(p.currency || 'USD'),
      amount: Number((Number(p.expected_amount_cents) / 100).toFixed(2)),
      cryptoCurrency: p.crypto_currency ? String(p.crypto_currency) : null,
      cryptoExpectedAmount: p.crypto_expected_amount ? String(p.crypto_expected_amount) : null,
      cryptoWalletAddress: p.crypto_wallet_address ? String(p.crypto_wallet_address) : null,
      cryptoNetwork: p.crypto_network ? String(p.crypto_network) : null,
      transactionRef: String(p.provider_transaction_id || p.tx_hash || ''),
      confirmations: Number(p.confirmations || 0),
      requiredConfirmations: Number(p.required_confirmations || 0),
      status: String(p.status),
      expiresAt: p.expires_at ? String(p.expires_at) : null,
      verifiedAt: p.verified_at ? String(p.verified_at) : null,
      createdAt: String(p.created_at),
    })),
  };
}

export function createPublicApiRouter(db: DbConnection, cfg: AppConfig) {
  const router = express.Router();

  const checkoutLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyPrefix: 'guest-checkout',
    message: 'Too many checkout submissions from this IP. Please try again later.',
  });

  const lookupLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 40,
    keyPrefix: 'order-lookup',
    message: 'Too many order lookup requests. Please wait a few minutes.',
  });

  const inquiryLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyPrefix: 'guest-inquiry',
    message: 'Too many inquiries submitted. Please try again shortly.',
  });

  /* ------------------------------------------------------------------------
     GET /api/storefront/bootstrap
     Public storefront data from real DB (zero secrets, zero admin URLs)
     ------------------------------------------------------------------------ */
  router.get('/storefront/bootstrap', (_req: Request, res: Response) => {
    const settingsRow = db
      .prepare('SELECT * FROM website_settings WHERE id = 1')
      .get() as Record<string, unknown>;

    const categories = db
      .prepare(
        `
        SELECT
          c.id, c.slug, c.name, c.description,
          COUNT(p.id) AS product_count,
          (
            SELECT p2.id FROM products p2
            WHERE p2.category_id = c.id
            ORDER BY p2.created_at DESC, p2.id DESC
            LIMIT 1
          ) AS latest_product_id,
          (
            SELECT p2.name FROM products p2
            WHERE p2.category_id = c.id
            ORDER BY p2.created_at DESC, p2.id DESC
            LIMIT 1
          ) AS latest_product_name,
          (
            SELECT p2.price_cents FROM products p2
            WHERE p2.category_id = c.id
            ORDER BY p2.created_at DESC, p2.id DESC
            LIMIT 1
          ) AS latest_product_price_cents
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id
        GROUP BY c.id
        ORDER BY c.name ASC
      `
      )
      .all() as Array<Record<string, unknown>>;

    const sellers = db
      .prepare(
        `
        SELECT
          s.id, s.username, s.location, s.specialty, s.response_time, s.active, s.created_at,
          COUNT(p.id) AS product_count
        FROM sellers s
        LEFT JOIN products p ON p.seller_id = s.id
        WHERE s.active = 1
        GROUP BY s.id
        ORDER BY s.username ASC
      `
      )
      .all() as Array<Record<string, unknown>>;

    const productRows = db
      .prepare(
        `
        SELECT
          p.*,
          c.slug AS category_slug,
          c.name AS category_name,
          s.username AS seller_username,
          s.location AS seller_location
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN sellers s ON s.id = p.seller_id
        ORDER BY p.created_at DESC, p.id DESC
      `
      )
      .all() as Array<Record<string, unknown>>;

    const wallets = getConfiguredCryptoWallets(db, cfg);
    const missingCs = getMissingCyberSourceVars(cfg);

    res.json({
      settings: {
        siteName: String(settingsRow?.site_name || 'RetroMarket'),
        tagline: String(settingsRow?.tagline || 'Classic Online Buying & Selling Directory'),
        logoPath: sanitizeImageUrl(
          String(settingsRow?.logo_path || ''),
          'assets/icons/logo-mark.svg'
        ),
        defaultCurrency: String(settingsRow?.default_currency || 'USD'),
        supportEmail: String(settingsRow?.support_email || ''),
        sellerContactInfo: String(settingsRow?.seller_contact_info || ''),
        guestCheckoutNotice: String(settingsRow?.guest_checkout_notice || ''),
      },
      paymentCapabilities: {
        cybersource: {
          configured: missingCs.length === 0,
          environment: cfg.cybersource.env,
        },
        cryptocurrency: {
          wallets: {
            BTC: {
              configured: Boolean(wallets.BTC.address),
              network: wallets.BTC.network,
              requiredConfirmations: wallets.BTC.requiredConfirmations,
            },
            ETH: {
              configured: Boolean(wallets.ETH.address),
              network: wallets.ETH.network,
              requiredConfirmations: wallets.ETH.requiredConfirmations,
            },
            USDT: {
              configured: Boolean(wallets.USDT.address),
              network: wallets.USDT.network,
              requiredConfirmations: wallets.USDT.requiredConfirmations,
            },
          },
          verifiers: getCryptoVerifierStatus(cfg),
        },
        manual: {
          configured: true,
          emailNotificationConfigured: isEmailConfigured(cfg),
        },
      },
      categories: categories.map((c) => ({
        id: Number(c.id),
        slug: String(c.slug),
        name: String(c.name),
        description: String(c.description || ''),
        productCount: Number(c.product_count || 0),
        latestProduct: c.latest_product_id
          ? {
              id: Number(c.latest_product_id),
              name: String(c.latest_product_name || ''),
              price: Number((Number(c.latest_product_price_cents || 0) / 100).toFixed(2)),
            }
          : null,
      })),
      sellers: sellers.map((s) => ({
        id: Number(s.id),
        username: String(s.username),
        location: String(s.location || ''),
        specialty: String(s.specialty || ''),
        responseTime: String(s.response_time || 'Within 24 hours'),
        active: Number(s.active) === 1,
        joined: String(s.created_at || '').slice(0, 4),
        productCount: Number(s.product_count || 0),
      })),
      products: productRows.map(formatPublicProduct),
      stats: {
        totalProducts: productRows.length,
        totalCategories: categories.length,
        activeSellers: sellers.length,
      },
    });
  });

  /* ------------------------------------------------------------------------
     GET /api/products & GET /api/products/:id
     ------------------------------------------------------------------------ */
  router.get('/products', (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const cat = String(req.query.cat || '').trim();
    const seller = String(req.query.seller || '').trim();
    const minRaw = String(req.query.min || '').trim();
    const maxRaw = String(req.query.max || '').trim();
    const sort = String(req.query.sort || 'newest').trim();

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (cat && cat !== 'all') {
      conditions.push('c.slug = ?');
      params.push(cat);
    }
    if (seller) {
      conditions.push('LOWER(s.username) = LOWER(?)');
      params.push(seller);
    }
    if (minRaw !== '' && Number.isFinite(Number(minRaw))) {
      conditions.push('p.price_cents >= ?');
      params.push(Math.round(Number(minRaw) * 100));
    }
    if (maxRaw !== '' && Number.isFinite(Number(maxRaw))) {
      conditions.push('p.price_cents <= ?');
      params.push(Math.round(Number(maxRaw) * 100));
    }
    if (q) {
      const like = `%${q}%`;
      conditions.push(
        '(CAST(p.id AS TEXT) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(s.username) LIKE ? OR LOWER(p.condition) LIKE ?)'
      );
      params.push(like, like, like, like, like, like);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    let orderBy = 'p.created_at DESC, p.id DESC';
    if (sort === 'price-asc') orderBy = 'p.price_cents ASC, p.id DESC';
    else if (sort === 'price-desc') orderBy = 'p.price_cents DESC, p.id DESC';
    else if (sort === 'name-asc') orderBy = 'p.name COLLATE NOCASE ASC';

    const rows = db
      .prepare(
        `
        SELECT
          p.*,
          c.slug AS category_slug,
          c.name AS category_name,
          s.username AS seller_username,
          s.location AS seller_location
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN sellers s ON s.id = p.seller_id
        ${whereClause}
        ORDER BY ${orderBy}
      `
      )
      .all(...params) as Array<Record<string, unknown>>;

    res.json({ products: rows.map(formatPublicProduct) });
  });

  router.get('/products/:id', (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const row = db
      .prepare(
        `
        SELECT
          p.*,
          c.slug AS category_slug,
          c.name AS category_name,
          s.username AS seller_username,
          s.location AS seller_location,
          s.specialty AS seller_specialty,
          s.response_time AS seller_response_time,
          s.created_at AS seller_created_at
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN sellers s ON s.id = p.seller_id
        WHERE p.id = ?
        LIMIT 1
      `
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const relatedRows = db
      .prepare(
        `
        SELECT
          p.*,
          c.slug AS category_slug,
          c.name AS category_name,
          s.username AS seller_username,
          s.location AS seller_location
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN sellers s ON s.id = p.seller_id
        WHERE p.id != ?
        ORDER BY (p.category_id = ?) DESC, p.created_at DESC
        LIMIT 4
      `
      )
      .all(id, Number(row.category_id)) as Array<Record<string, unknown>>;

    const sellerListingCount = (
      db
        .prepare('SELECT COUNT(*) AS count FROM products WHERE seller_id = ?')
        .get(Number(row.seller_id)) as { count: number }
    ).count;

    res.json({
      product: formatPublicProduct(row),
      seller: {
        id: Number(row.seller_id),
        username: String(row.seller_username),
        location: String(row.seller_location || ''),
        specialty: String(row.seller_specialty || ''),
        responseTime: String(row.seller_response_time || 'Within 24 hours'),
        joined: String(row.seller_created_at || '').slice(0, 4),
        listingCount: sellerListingCount,
      },
      related: relatedRows.map(formatPublicProduct),
    });
  });

  /* ------------------------------------------------------------------------
     POST /api/orders — Real Guest Checkout (Strict Server-Side Totals & Stock)
     ------------------------------------------------------------------------ */
  router.post('/orders', checkoutLimiter, (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const country = String(body.country || '').trim();
    const city = String(body.city || '').trim();
    const shippingAddress = String(body.shippingAddress || '').trim();
    const notes = String(body.notes || '').trim().slice(0, 1000);
    const paymentMethod = String(body.paymentMethod || '').trim().toLowerCase();
    const itemsRaw = Array.isArray(body.items) ? body.items : [];

    const errors: string[] = [];
    if (fullName.length < 2 || fullName.length > 120) {
      errors.push('Full Name is required (2–120 characters).');
    }
    if (!isValidEmail(email)) {
      errors.push('A valid Email Address is required.');
    }
    if (!isValidPhone(phone)) {
      errors.push('Phone Number must contain 7 to 15 digits.');
    }
    if (country.length < 2 || country.length > 80) {
      errors.push('Country is required.');
    }
    if (city.length < 2 || city.length > 80) {
      errors.push('City is required.');
    }
    if (!['cybersource', 'cryptocurrency', 'manual'].includes(paymentMethod)) {
      errors.push('A valid payment method must be selected.');
    }
    if (itemsRaw.length === 0 || itemsRaw.length > 50) {
      errors.push('Your shopping cart must contain at least 1 product.');
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors[0], errors });
      return;
    }

    // Deduplicate and strictly validate requested product IDs + integer quantities
    const requestedMap = new Map<number, number>();
    for (const entry of itemsRaw) {
      const obj = entry as Record<string, unknown>;
      const pid = parseInt(String(obj.id ?? ''), 10);
      const qty = parseInt(String(obj.qty ?? ''), 10);
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(qty) || qty < 1 || qty > 100) {
        res.status(400).json({ error: 'Invalid product ID or quantity in cart payload.' });
        return;
      }
      requestedMap.set(pid, (requestedMap.get(pid) || 0) + qty);
    }

    const settingsRow = db
      .prepare('SELECT default_currency FROM website_settings WHERE id = 1')
      .get() as { default_currency?: string } | undefined;
    const currency = String(settingsRow?.default_currency || 'USD');

    try {
      const createdOrderRow = runInTransaction(db, () => {
        let subtotalCents = 0;
        let shippingCents = 0;
        let requiresShipping = false;

        const verifiedItems: Array<{
          productId: number;
          name: string;
          sellerUsername: string;
          unitPriceCents: number;
          qty: number;
          lineTotalCents: number;
          lineShippingCents: number;
          stockQuantity: number;
        }> = [];

        for (const [productId, qty] of requestedMap.entries()) {
          const prod = db
            .prepare(
              `
              SELECT p.*, s.username AS seller_username
              FROM products p
              JOIN sellers s ON s.id = p.seller_id
              WHERE p.id = ?
              LIMIT 1
            `
            )
            .get(productId) as Record<string, unknown> | undefined;

          if (!prod) {
            throw Object.assign(new Error(`Product #${productId} was not found in the catalog.`), {
              statusCode: 400,
            });
          }

          const stockQty = Number(prod.stock_quantity || 0);
          if (Number(prod.in_stock) !== 1 || stockQty < qty) {
            throw Object.assign(
              new Error(
                `Insufficient stock for "${String(prod.name)}" (requested ${qty}, available ${stockQty}).`
              ),
              { statusCode: 409 }
            );
          }

          const unitPriceCents = Number(prod.price_cents);
          const itemShippingCents = Number(prod.shipping_cost_cents || 0);
          const lineTotalCents = unitPriceCents * qty;
          const isDigital = Number(prod.is_digital) === 1;

          if (!isDigital) {
            requiresShipping = true;
          }

          subtotalCents += lineTotalCents;
          shippingCents += itemShippingCents;

          verifiedItems.push({
            productId,
            name: String(prod.name),
            sellerUsername: String(prod.seller_username),
            unitPriceCents,
            qty,
            lineTotalCents,
            lineShippingCents: itemShippingCents,
            stockQuantity: stockQty,
          });
        }

        if (requiresShipping && shippingAddress.length < 5) {
          throw Object.assign(
            new Error('Shipping Address is required because your order includes physical items.'),
            { statusCode: 400 }
          );
        }

        const totalCents = subtotalCents + shippingCents;
        const orderNumber = `RM-${new Date().getUTCFullYear()}-${generateSecureToken(4).toUpperCase()}`;

        const orderRes = db
          .prepare(
            `
            INSERT INTO orders (
              order_number, customer_name, customer_email, customer_phone,
              customer_country, customer_city, shipping_address, requires_shipping,
              customer_notes, subtotal_cents, shipping_cents, total_cents,
              currency, payment_method, payment_status, order_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Pending')
          `
          )
          .run(
            orderNumber,
            fullName,
            email,
            phone,
            country,
            city,
            requiresShipping ? shippingAddress : shippingAddress || 'Digital Delivery',
            requiresShipping ? 1 : 0,
            notes,
            subtotalCents,
            shippingCents,
            totalCents,
            currency,
            paymentMethod
          );

        const orderId = Number(orderRes.lastInsertRowid);

        const insertItemStmt = db.prepare(
          `
          INSERT INTO order_items (
            order_id, product_id, product_name, seller_username,
            unit_price_cents, quantity, line_total_cents, line_shipping_cents
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        );

        const decrementStockStmt = db.prepare(
          `
          UPDATE products
          SET
            stock_quantity = stock_quantity - ?,
            in_stock = CASE WHEN (stock_quantity - ?) <= 0 THEN 0 ELSE in_stock END,
            availability = CASE
              WHEN (stock_quantity - ?) <= 0 THEN 'Out of Stock'
              ELSE 'In Stock (' || (stock_quantity - ?) || ' available)'
            END,
            updated_at = datetime('now')
          WHERE id = ? AND stock_quantity >= ?
        `
        );

        for (const item of verifiedItems) {
          insertItemStmt.run(
            orderId,
            item.productId,
            item.name,
            item.sellerUsername,
            item.unitPriceCents,
            item.qty,
            item.lineTotalCents,
            item.lineShippingCents
          );

          const stockUpdate = decrementStockStmt.run(
            item.qty,
            item.qty,
            item.qty,
            item.qty,
            item.productId,
            item.qty
          );
          if (stockUpdate.changes !== 1) {
            throw Object.assign(
              new Error(`Stock changed concurrently for "${item.name}". Please retry checkout.`),
              { statusCode: 409 }
            );
          }
        }

        // Create initial payment ledger record for manual orders right away
        if (paymentMethod === 'manual') {
          const payRef = `MAN-${new Date().getUTCFullYear()}-${generateSecureToken(5).toUpperCase()}`;
          db.prepare(
            `
            INSERT INTO payments (
              payment_ref, order_id, method, provider, currency,
              expected_amount_cents, status, review_note
            ) VALUES (?, ?, 'manual', 'Direct Seller Arrangement', ?, ?, 'Pending', 'Awaiting manual payment coordination')
          `
          ).run(payRef, orderId, currency, totalCents);
        }

        return db
          .prepare('SELECT * FROM orders WHERE id = ? LIMIT 1')
          .get(orderId) as Record<string, unknown>;
      });

      res.status(201).json({
        order: formatPublicOrder(db, createdOrderRow),
      });
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? Number((err as { statusCode: number }).statusCode)
          : 500;
      const message =
        status >= 400 && status < 500 && err instanceof Error
          ? err.message
          : 'Unable to complete checkout at this time.';
      res.status(status).json({ error: message });
    }
  });

  /* ------------------------------------------------------------------------
     POST /api/orders/lookup — Guest Order Lookup (Requires Order ID + Email)
     ------------------------------------------------------------------------ */
  router.post('/orders/lookup', lookupLimiter, (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const orderNumber = String(body.orderNumber || '').trim();
    const email = String(body.email || '').trim().toLowerCase();

    if (!orderNumber || !isValidEmail(email)) {
      res.status(400).json({
        error: 'Both Order Reference ID and the Email Address used at checkout are required.',
      });
      return;
    }

    const row = db
      .prepare(
        `
        SELECT * FROM orders
        WHERE LOWER(order_number) = LOWER(?) AND LOWER(customer_email) = LOWER(?)
        LIMIT 1
      `
      )
      .get(orderNumber, email) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({
        error: 'No order matched that Order Reference ID and Email Address.',
      });
      return;
    }

    res.json({ order: formatPublicOrder(db, row) });
  });

  /* ------------------------------------------------------------------------
     POST /api/inquiries — Guest Seller / Support Inquiry
     ------------------------------------------------------------------------ */
  router.post('/inquiries', inquiryLimiter, async (req: Request, res: Response) => {
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

    let validProductId: number | null = null;
    let productLabel = '';
    if (productId) {
      const prod = db
        .prepare('SELECT id, name FROM products WHERE id = ? LIMIT 1')
        .get(productId) as { id: number; name: string } | undefined;
      if (prod) {
        validProductId = prod.id;
        productLabel = `#${prod.id} — ${prod.name}`;
      }
    }

    const inquiryRef = `INQ-${new Date().getUTCFullYear()}-${generateSecureToken(4).toUpperCase()}`;

    // Resolve recipient email from sellers table or support settings
    let targetEmail = '';
    const sellerRow = db
      .prepare('SELECT email FROM sellers WHERE LOWER(username) = LOWER(?) AND active = 1 LIMIT 1')
      .get(recipient) as { email?: string } | undefined;
    if (sellerRow?.email) {
      targetEmail = sellerRow.email;
    } else {
      const settingsRow = db
        .prepare('SELECT support_email FROM website_settings WHERE id = 1')
        .get() as { support_email?: string } | undefined;
      targetEmail = String(settingsRow?.support_email || '').trim();
    }

    let emailDelivered = false;
    try {
      if (targetEmail && isEmailConfigured(cfg)) {
        emailDelivered = await sendSellerInquiryEmail(cfg, {
          to: targetEmail,
          replyTo: guestEmail,
          inquiryRef,
          recipientLabel: recipient,
          guestName,
          orderNumber,
          productLabel,
          message,
        });
      }
    } catch {
      emailDelivered = false;
    }

    db.prepare(
      `
      INSERT INTO seller_inquiries (
        inquiry_ref, recipient, product_id, order_number,
        guest_name, guest_email, message, email_delivered
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      inquiryRef,
      recipient,
      validProductId,
      orderNumber,
      guestName,
      guestEmail,
      message,
      emailDelivered ? 1 : 0
    );

    // If this inquiry references an existing manual payment order belonging to this email, mark Awaiting Verification
    if (orderNumber) {
      const matchingOrder = db
        .prepare(
          `
          SELECT id, payment_method, payment_status
          FROM orders
          WHERE LOWER(order_number) = LOWER(?) AND LOWER(customer_email) = LOWER(?)
          LIMIT 1
        `
        )
        .get(orderNumber, guestEmail) as
        | { id: number; payment_method: string; payment_status: string }
        | undefined;

      if (
        matchingOrder &&
        matchingOrder.payment_method === 'manual' &&
        matchingOrder.payment_status === 'Pending'
      ) {
        runInTransaction(db, () => {
          db.prepare(
            `UPDATE orders SET payment_status = 'Awaiting Verification', updated_at = datetime('now') WHERE id = ?`
          ).run(matchingOrder.id);
          db.prepare(
            `
            UPDATE payments
            SET status = 'Awaiting Verification', review_note = ?, updated_at = datetime('now')
            WHERE order_id = ? AND method = 'manual' AND status = 'Pending'
          `
          ).run(`Manual payment inquiry ${inquiryRef} submitted by buyer`, matchingOrder.id);
        });
      }
    }

    res.status(201).json({
      inquiryRef,
      emailDelivered,
      message: emailDelivered
        ? `Inquiry ${inquiryRef} saved and forwarded via email to ${recipient}.`
        : `Inquiry ${inquiryRef} saved to RetroMarket database for ${recipient}. (SMTP email forwarding is not configured on this server.)`,
    });
  });

  /* ------------------------------------------------------------------------
     CyberSource Secure Acceptance Endpoints
     ------------------------------------------------------------------------ */
  router.post('/payments/cybersource/create-session', checkoutLimiter, (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const orderNumber = String(body.orderNumber || '').trim();
    const customerEmail = String(body.email || '').trim();
    if (!orderNumber || !isValidEmail(customerEmail)) {
      res.status(400).json({ error: 'Order Reference ID and checkout Email Address are required.' });
      return;
    }

    const result = createCyberSourceCheckoutSession(db, cfg, { orderNumber, customerEmail });
    if (!result.ok) {
      res.status(result.statusCode).json({
        error: result.error,
        missingVars: result.missingVars,
      });
      return;
    }

    res.json({
      paymentRef: result.paymentRef,
      actionUrl: result.actionUrl,
      fields: result.fields,
    });
  });

  // Server-to-server CyberSource Merchant POST / Notification Webhook
  router.post(
    '/payments/cybersource/webhook',
    express.urlencoded({ extended: false }),
    (req: Request, res: Response) => {
      const payload = (req.body || {}) as Record<string, unknown>;
      const result = processCyberSourceNotification(db, cfg, payload, true);
      if (!result.ok) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }
      res.status(200).json({
        ok: true,
        orderNumber: result.orderNumber,
        paymentStatus: result.paymentStatus,
        transactionId: result.transactionId,
      });
    }
  );

  // Browser return URL from CyberSource Hosted Checkout (NEVER marks Paid on its own)
  router.post(
    '/payments/cybersource/return',
    express.urlencoded({ extended: false }),
    (req: Request, res: Response) => {
      const payload = (req.body || {}) as Record<string, unknown>;
      const result = processCyberSourceNotification(db, cfg, payload, false);
      const orderNum = encodeURIComponent(
        result.orderNumber || String(payload.req_reference_number || '')
      );
      const state = encodeURIComponent(
        result.ok ? String(result.paymentStatus || 'Awaiting Verification') : 'InvalidSignature'
      );
      const txRef = encodeURIComponent(result.transactionId || '');
      res.redirect(303, `/payment.html?order=${orderNum}&method=cybersource&gateway_status=${state}&tx_ref=${txRef}`);
    }
  );

  /* ------------------------------------------------------------------------
     Cryptocurrency Payment Endpoints
     ------------------------------------------------------------------------ */
  router.post('/payments/crypto/create-invoice', checkoutLimiter, async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const orderNumber = String(body.orderNumber || '').trim();
    const customerEmail = String(body.email || '').trim();
    const coin = String(body.coin || '').trim();

    if (!orderNumber || !isValidEmail(customerEmail)) {
      res.status(400).json({ error: 'Order Reference ID and checkout Email Address are required.' });
      return;
    }

    const result = await createCryptoInvoice(db, cfg, { orderNumber, customerEmail, coin });
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }

    res.status(201).json({ invoice: result.invoice });
  });

  router.post('/payments/crypto/submit-tx', checkoutLimiter, async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const orderNumber = String(body.orderNumber || '').trim();
    const customerEmail = String(body.email || '').trim();
    const paymentRef = String(body.paymentRef || '').trim();
    const coin = String(body.coin || '').trim();
    const txHash = String(body.txHash || '').trim();

    if (!orderNumber || !isValidEmail(customerEmail)) {
      res.status(400).json({ error: 'Order Reference ID and checkout Email Address are required.' });
      return;
    }

    const result = await submitCryptoTransactionHash(db, cfg, {
      orderNumber,
      customerEmail,
      paymentRef: paymentRef || undefined,
      coin: coin || undefined,
      txHash,
    });

    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }

    res.json(result);
  });

  router.post(
    '/payments/crypto/webhook',
    express.text({ type: 'application/json', limit: '256kb' }),
    (req: Request, res: Response) => {
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      const sig = String(req.headers['x-crypto-webhook-signature'] || '');
      const result = processCryptoWebhook(db, cfg, rawBody, sig);
      if (!result.ok) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }
      res.status(200).json({ ok: true });
    }
  );

  return router;
}
