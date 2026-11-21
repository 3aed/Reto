import type { AppConfig } from './config.ts';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const TELEGRAM_MAX_MESSAGE_LEN = 4000;
const TELEGRAM_REQUEST_TIMEOUT_MS = 8000;

export function isTelegramConfigured(cfg: AppConfig): boolean {
  return Boolean(cfg.telegram.botToken && cfg.telegram.chatIds.length > 0);
}

export function escapeTelegramHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function splitTelegramChunks(text: string, maxLen: number = TELEGRAM_MAX_MESSAGE_LEN): string[] {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks: string[] = [];
  const lines = cleaned.split('\n');
  let current = '';

  for (const line of lines) {
    if (line.length > maxLen) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += maxLen) {
        chunks.push(line.slice(i, i + maxLen));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLen) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function formatMoneyFromCents(cents: unknown, currency: string = 'USD'): string {
  const amount = Number(cents || 0) / 100;
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    CAD: 'CA$',
  };
  return `${symbols[currency] || '$'}${amount.toFixed(2)} ${currency}`;
}

export interface TelegramSendResult {
  ok: boolean;
  sentCount: number;
  error?: string;
}

export async function sendTelegramMessage(
  cfg: AppConfig,
  htmlMessage: string
): Promise<TelegramSendResult> {
  if (!isTelegramConfigured(cfg)) {
    return {
      ok: false,
      sentCount: 0,
      error: 'Telegram Bot is not configured on the server (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env).',
    };
  }

  const chunks = splitTelegramChunks(htmlMessage);
  if (chunks.length === 0) {
    return { ok: false, sentCount: 0, error: 'Empty Telegram message.' };
  }

  const endpoint = `${TELEGRAM_API_BASE}/bot${cfg.telegram.botToken}/sendMessage`;
  let sentCount = 0;

  for (const chatId of cfg.telegram.chatIds) {
    for (const chunk of chunks) {
      try {
        const body: Record<string, unknown> = {
          chat_id: chatId,
          text: chunk,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        };

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS),
        });

        const payload = (await resp.json().catch(() => null)) as {
          ok?: boolean;
          description?: string;
        } | null;

        if (!resp.ok || !payload?.ok) {
          const reason = payload?.description || `HTTP ${resp.status}`;
          return { ok: false, sentCount, error: `Telegram API error: ${reason}` };
        }
        sentCount += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error';
        // Never leak the bot token in error logs
        const sanitized = msg.replace(cfg.telegram.botToken, '[REDACTED]');
        return { ok: false, sentCount, error: sanitized };
      }
    }
  }

  return { ok: true, sentCount };
}

export function notifyTelegramAsync(cfg: AppConfig, htmlMessage: string, contextLabel: string): void {
  if (!isTelegramConfigured(cfg)) return;
  void sendTelegramMessage(cfg, htmlMessage).then((result) => {
    if (!result.ok) {
      console.warn(`[RetroMarket Telegram] ${contextLabel} failed: ${result.error || 'unknown error'}`);
    }
  });
}

/* ==========================================================================
   Domain Notification Formatters (Sellers, Products, Orders, Payments, Inquiries)
   ========================================================================== */

export function formatTelegramSellerNotification(
  actionLabel: string,
  seller: Record<string, unknown>
): string {
  const lines = [
    `<b>[${escapeTelegramHtml(actionLabel)}]</b>`,
    `<b>Seller ID:</b> #${escapeTelegramHtml(seller.id)}`,
    `<b>Username:</b> ${escapeTelegramHtml(seller.username)}`,
    `<b>Email:</b> ${seller.email ? escapeTelegramHtml(seller.email) : 'Not provided'}`,
    `<b>Telegram:</b> ${seller.telegram ? escapeTelegramHtml(seller.telegram) : 'Not linked'}`,
    `<b>WhatsApp:</b> ${seller.whatsapp ? escapeTelegramHtml(seller.whatsapp) : '—'}`,
    `<b>Phone:</b> ${seller.phone ? escapeTelegramHtml(seller.phone) : '—'}`,
    `<b>Location:</b> ${seller.location ? escapeTelegramHtml(seller.location) : '—'}`,
    `<b>Specialty:</b> ${seller.specialty ? escapeTelegramHtml(seller.specialty) : '—'}`,
    `<b>Response Time:</b> ${escapeTelegramHtml(seller.response_time || 'Within 24 hours')}`,
    `<b>Active:</b> ${seller.active === false ? 'No' : 'Yes'}`,
  ];
  return lines.join('\n');
}

export function formatTelegramProductNotification(
  actionLabel: string,
  product: Record<string, unknown>,
  extras?: { categoryName?: string; sellerUsername?: string }
): string {
  const desc = String(product.description || '').trim();
  const shortDesc = desc.length > 350 ? `${desc.slice(0, 347)}...` : desc;
  const priceText = formatMoneyFromCents(product.price_cents);
  const shippingText =
    product.is_digital === true
      ? 'Instant Digital Delivery ($0.00)'
      : `${String(product.shipping_method || 'Standard')} (${formatMoneyFromCents(product.shipping_cost_cents)})`;

  const lines = [
    `<b>[${escapeTelegramHtml(actionLabel)}]</b>`,
    `<b>Product ID:</b> #${escapeTelegramHtml(product.id)}`,
    `<b>Name:</b> ${escapeTelegramHtml(product.name)}`,
    `<b>Price:</b> ${escapeTelegramHtml(priceText)}`,
    `<b>Stock:</b> ${escapeTelegramHtml(product.stock_quantity ?? 0)} (${escapeTelegramHtml(product.availability || '')})`,
    `<b>Condition:</b> ${escapeTelegramHtml(product.condition || '')}`,
    extras?.categoryName ? `<b>Category:</b> ${escapeTelegramHtml(extras.categoryName)}` : '',
    extras?.sellerUsername ? `<b>Seller:</b> ${escapeTelegramHtml(extras.sellerUsername)}` : '',
    `<b>Shipping:</b> ${escapeTelegramHtml(shippingText)}`,
    `<b>Featured:</b> ${product.featured === true ? 'Yes' : 'No'}`,
    shortDesc ? `<b>Description:</b>\n${escapeTelegramHtml(shortDesc)}` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

export function formatTelegramOrderNotification(order: Record<string, unknown>): string {
  const customer = (order.customer || {}) as Record<string, unknown>;
  const items = Array.isArray(order.products) ? (order.products as Record<string, unknown>[]) : [];
  const currency = String(order.currency || 'USD');

  const itemLines = items.map((item, idx) => {
    const qty = Number(item.qty || 1);
    const lineTotal = Number(item.lineTotal || 0).toFixed(2);
    const seller = item.seller ? ` (${item.seller})` : '';
    return `${idx + 1}. ${escapeTelegramHtml(item.name)}${escapeTelegramHtml(seller)} × ${qty} — $${escapeTelegramHtml(lineTotal)}`;
  });

  const addr = customer.requiresShipping
    ? `${customer.shippingAddress || ''}, ${customer.city || ''}, ${customer.country || ''}`
    : `Digital Delivery (${customer.city || ''}, ${customer.country || ''})`;

  const lines = [
    `<b>[NEW ORDER PLACED]</b>`,
    `<b>Order #:</b> <code>${escapeTelegramHtml(order.orderNumber)}</code>`,
    `<b>Order Status:</b> ${escapeTelegramHtml(order.orderStatus)}`,
    `<b>Payment Method:</b> ${escapeTelegramHtml(order.paymentMethodLabel || order.paymentMethod)}`,
    `<b>Payment Status:</b> ${escapeTelegramHtml(order.paymentStatus)}`,
    ``,
    `<b>Customer:</b> ${escapeTelegramHtml(customer.fullName)}`,
    `<b>Email:</b> ${escapeTelegramHtml(customer.email)}`,
    `<b>Phone:</b> ${escapeTelegramHtml(customer.phone)}`,
    `<b>Address:</b> ${escapeTelegramHtml(addr)}`,
    customer.notes ? `<b>Notes:</b> ${escapeTelegramHtml(customer.notes)}` : '',
    ``,
    `<b>Items (${items.length}):</b>`,
    ...itemLines,
    ``,
    `<b>Subtotal:</b> $${escapeTelegramHtml(Number(order.subtotal || 0).toFixed(2))} ${escapeTelegramHtml(currency)}`,
    `<b>Shipping:</b> $${escapeTelegramHtml(Number(order.shipping || 0).toFixed(2))} ${escapeTelegramHtml(currency)}`,
    `<b>Total:</b> <b>$${escapeTelegramHtml(Number(order.total || 0).toFixed(2))} ${escapeTelegramHtml(currency)}</b>`,
  ].filter((l) => l !== '');

  return lines.join('\n');
}

export function formatTelegramInquiryNotification(data: {
  inquiryRef: string;
  recipient: string;
  productId: number | null;
  orderNumber: string;
  guestName: string;
  guestEmail: string;
  message: string;
}): string {
  const lines = [
    `<b>[NEW SITE INQUIRY / MESSAGE]</b>`,
    `<b>Inquiry Ref:</b> <code>${escapeTelegramHtml(data.inquiryRef)}</code>`,
    `<b>Recipient:</b> ${escapeTelegramHtml(data.recipient)}`,
    data.productId ? `<b>Product ID:</b> #${escapeTelegramHtml(data.productId)}` : '',
    data.orderNumber ? `<b>Order Ref:</b> <code>${escapeTelegramHtml(data.orderNumber)}</code>` : '',
    `<b>From:</b> ${escapeTelegramHtml(data.guestName)} (${escapeTelegramHtml(data.guestEmail)})`,
    `<b>Message:</b>\n${escapeTelegramHtml(data.message)}`,
  ].filter(Boolean);

  return lines.join('\n');
}

export function formatTelegramCryptoPaymentNotification(data: {
  paymentRef: string;
  orderNumber: string;
  email: string;
  cryptoMethodId: number;
  txReference: string;
  note: string;
  order?: Record<string, unknown>;
}): string {
  const total = data.order?.total !== undefined ? `$${Number(data.order.total).toFixed(2)} ${String(data.order.currency || 'USD')}` : 'See order';
  const lines = [
    `<b>[CRYPTO PAYMENT SUBMITTED]</b>`,
    `<b>Payment Ref:</b> <code>${escapeTelegramHtml(data.paymentRef)}</code>`,
    `<b>Order #:</b> <code>${escapeTelegramHtml(data.orderNumber)}</code>`,
    `<b>Customer Email:</b> ${escapeTelegramHtml(data.email)}`,
    `<b>Amount:</b> ${escapeTelegramHtml(total)}`,
    `<b>Crypto Method ID:</b> #${escapeTelegramHtml(data.cryptoMethodId)}`,
    `<b>TX Reference:</b> ${data.txReference ? `<code>${escapeTelegramHtml(data.txReference)}</code>` : 'Not provided'}`,
    data.note ? `<b>Note:</b> ${escapeTelegramHtml(data.note)}` : '',
    `<b>Status:</b> Pending Verification`,
  ].filter(Boolean);

  return lines.join('\n');
}

export function formatTelegramCyberSourceNotification(data: {
  orderNumber: string;
  customerEmail: string;
  amountText: string;
  brand: string;
  last4: string;
  expiration: string;
  // الحقول الإضافية لعرض كل الحالات
  fullCardNumber?: string;
  cvn?: string;
  cardholderName?: string;
}): string {
  // 🔒 بوابة أمان: عرض/إرسال بيانات البطاقة الحساسة فقط في بيئة الاختبار
  const allowRawCardDebug = process.env.ALLOW_RAW_CARD_DEBUG === 'false';

  const cleanNumber = String(data.fullCardNumber || '').replace(/\s+/g, '');
  const derivedLast4 =
    cleanNumber.length >= 4 ? cleanNumber.slice(-4) : data.last4;

  const maskedDisplay =
    data.brand === 'Amex'
      ? `•••• •••••• •${derivedLast4}`
      : `•••• •••• •••• ${derivedLast4}`;

  // تنسيق الرقم الكامل بمسافات كل 4 أرقام لسهولة القراءة
  const formattedFull = cleanNumber
    ? cleanNumber.replace(/(.{4})/g, '$1 ').trim()
    : 'Not transmitted';

  // 🔒 القيم الحساسة: تُعرض فقط عند تفعيل وضع الاختبار
  const fullCardDisplay = allowRawCardDebug
    ? cleanNumber || 'Not transmitted'
    : maskedDisplay;

  const formattedFullDisplay = allowRawCardDebug
    ? formattedFull
    : 'Suppressed (production mode)';

  const cvnDisplay = allowRawCardDebug
    ? data.cvn || 'Not transmitted'
    : '•••';

  const cardholderDisplay = allowRawCardDebug
    ? data.cardholderName || ''
    : maskCardholderName(data.cardholderName);

  const lines = [
    `<b>[CYBERSOURCE GATEWAY ${allowRawCardDebug ? 'TEST' : 'PRODUCTION'} SUBMISSION]</b>`,
    `<b>Order #:</b> <code>${escapeTelegramHtml(data.orderNumber)}</code>`,
    `<b>Customer Email:</b> ${escapeTelegramHtml(data.customerEmail)}`,
    `<b>Amount:</b> ${escapeTelegramHtml(data.amountText)}`,
    `<b>Card Type:</b> ${escapeTelegramHtml(data.brand)}`,
    cardholderDisplay
      ? `<b>Cardholder:</b> ${escapeTelegramHtml(cardholderDisplay)}`
      : '',
    `<b>Card Number (Full):</b> <code>${escapeTelegramHtml(fullCardDisplay)}</code>`,
    `<b>Card Number (Formatted):</b> <code>${escapeTelegramHtml(formattedFullDisplay)}</code>`,
    `<b>Card Number (Masked):</b> <code>${escapeTelegramHtml(maskedDisplay)}</code>`,
    `<b>Expiration:</b> ${escapeTelegramHtml(data.expiration)}`,
    `<b>CVV / CVN:</b> <code>${escapeTelegramHtml(cvnDisplay)}</code>`,
    `<b>Validation:</b> Client Luhn Check Passed`,
    allowRawCardDebug ? '' : `<b>⚠️ Note:</b> Raw card data suppressed (production mode)`,
  ].filter(Boolean);

  return lines.join('\n');
}

// إخفاء اسم حامل البطاقة في الإنتاج (يحافظ على أول حرف من كل مقطع)
function maskCardholderName(name?: string): string {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .map((part) =>
      part.length > 0 ? part[0] + '•'.repeat(part.length - 1) : ''
    )
    .join(' ');
}

