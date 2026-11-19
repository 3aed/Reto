import crypto from 'node:crypto';
import type { AppConfig } from '../config.ts';
import { getMissingCyberSourceVars } from '../config.ts';
import type { DbConnection } from '../db.ts';
import { runInTransaction } from '../db.ts';
import { generateSecureToken, timingSafeEqualStr } from '../security.ts';

/**
 * Generates an official CyberSource Secure Acceptance Hosted Checkout HMAC-SHA256 signature.
 * Spec: sort/preserve exact `signed_field_names` order, join `key=value` pairs with `,`,
 * compute HMAC-SHA256 using merchant `secret_key`, encode as Base64.
 */
export function signCyberSourceFields(
  fields: Record<string, string>,
  signedFieldNames: string[],
  secretKey: string
): string {
  const dataToSign = signedFieldNames
    .map((name) => `${name}=${fields[name] ?? ''}`)
    .join(',');
  return crypto.createHmac('sha256', secretKey).update(dataToSign, 'utf8').digest('base64');
}

export function verifyCyberSourceSignature(
  payload: Record<string, unknown>,
  secretKey: string
): boolean {
  const signature = typeof payload.signature === 'string' ? payload.signature.trim() : '';
  const signedNamesRaw =
    typeof payload.signed_field_names === 'string' ? payload.signed_field_names.trim() : '';

  if (!signature || !signedNamesRaw || !secretKey) {
    return false;
  }

  const signedFieldNames = signedNamesRaw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (signedFieldNames.length === 0) {
    return false;
  }

  const stringFields: Record<string, string> = {};
  for (const name of signedFieldNames) {
    const val = payload[name];
    stringFields[name] = val === undefined || val === null ? '' : String(val);
  }

  const expected = signCyberSourceFields(stringFields, signedFieldNames, secretKey);
  return timingSafeEqualStr(signature, expected);
}

export function createCyberSourceCheckoutSession(
  db: DbConnection,
  cfg: AppConfig,
  params: { orderNumber: string; customerEmail: string }
):
  | {
      ok: true;
      paymentRef: string;
      actionUrl: string;
      fields: Record<string, string>;
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
      missingVars?: string[];
    } {
  const missing = getMissingCyberSourceVars(cfg);
  if (missing.length > 0) {
    return {
      ok: false,
      statusCode: 503,
      error:
        'CyberSource Secure Acceptance is not configured on this server. Real merchant credentials are required before card checkout can be initiated.',
      missingVars: missing,
    };
  }

  const order = db
    .prepare(
      `
      SELECT id, order_number, customer_email, total_cents, currency, payment_status, order_status
      FROM orders
      WHERE order_number = ?
      LIMIT 1
    `
    )
    .get(params.orderNumber.trim()) as
    | {
        id: number;
        order_number: string;
        customer_email: string;
        total_cents: number;
        currency: string;
        payment_status: string;
        order_status: string;
      }
    | undefined;

  if (!order || order.customer_email.toLowerCase() !== params.customerEmail.trim().toLowerCase()) {
    return {
      ok: false,
      statusCode: 404,
      error: 'Order not found for the provided Order Reference ID and Email Address.',
    };
  }

  if (order.payment_status === 'Paid') {
    return {
      ok: false,
      statusCode: 409,
      error: 'This order has already been paid and cannot be charged again.',
    };
  }

  if (order.order_status === 'Cancelled') {
    return {
      ok: false,
      statusCode: 409,
      error: 'Cancelled orders cannot initiate payment.',
    };
  }

  const amountStr = (order.total_cents / 100).toFixed(2);
  const transactionUuid = crypto.randomUUID();
  const signedDateTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const paymentRef = `CS-${new Date().getUTCFullYear()}-${generateSecureToken(5).toUpperCase()}`;

  const fields: Record<string, string> = {
    access_key: cfg.cybersource.accessKey,
    profile_id: cfg.cybersource.profileId,
    transaction_uuid: transactionUuid,
    signed_field_names:
      'access_key,profile_id,transaction_uuid,signed_field_names,unsigned_field_names,signed_date_time,locale,transaction_type,reference_number,amount,currency,override_custom_receipt_page,override_custom_cancel_page',
    unsigned_field_names: '',
    signed_date_time: signedDateTime,
    locale: 'en',
    transaction_type: 'sale',
    reference_number: order.order_number,
    amount: amountStr,
    currency: order.currency || 'USD',
    override_custom_receipt_page: `${cfg.appUrl}/api/payments/cybersource/return`,
    override_custom_cancel_page: `${cfg.appUrl}/api/payments/cybersource/return`,
  };

  const signedFieldNames = fields.signed_field_names.split(',');
  fields.signature = signCyberSourceFields(fields, signedFieldNames, cfg.cybersource.secretKey);

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  runInTransaction(db, () => {
    db.prepare(
      `
      INSERT INTO payments (
        payment_ref, order_id, method, provider, currency,
        expected_amount_cents, status, expires_at, review_note
      ) VALUES (?, ?, 'cybersource', ?, ?, ?, 'Pending', ?, ?)
    `
    ).run(
      paymentRef,
      order.id,
      `CyberSource Secure Acceptance (${cfg.cybersource.env})`,
      order.currency || 'USD',
      order.total_cents,
      expiresAt,
      `Hosted session created (UUID ${transactionUuid})`
    );

    db.prepare(
      `
      UPDATE orders
      SET payment_method = 'cybersource', updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(order.id);
  });

  return {
    ok: true,
    paymentRef,
    actionUrl: cfg.cybersource.hostedCheckoutUrl,
    fields,
  };
}

/**
 * Processes an authenticated CyberSource Secure Acceptance server-to-server webhook
 * (Merchant POST URL) OR a browser return POST.
 *
 * SECURITY RULE:
 * - Both paths MUST cryptographically verify CyberSource's HMAC-SHA256 signature.
 * - ONLY the server-to-server webhook (`isServerWebhook === true`) with a verified signature,
 *   matching order reference & amount, and `decision === 'ACCEPT'` may mark an order `Paid`.
 * - Browser return redirects NEVER mark an order `Paid` on their own; they record
 *   `Awaiting Verification` on ACCEPT until the server webhook confirms settlement.
 */
export function processCyberSourceNotification(
  db: DbConnection,
  cfg: AppConfig,
  payload: Record<string, unknown>,
  isServerWebhook: boolean
): {
  ok: boolean;
  statusCode: number;
  orderNumber?: string;
  paymentStatus?: string;
  transactionId?: string;
  error?: string;
} {
  const missing = getMissingCyberSourceVars(cfg);
  if (missing.length > 0) {
    return {
      ok: false,
      statusCode: 503,
      error: 'CyberSource secret key is not configured on this server.',
    };
  }

  if (!verifyCyberSourceSignature(payload, cfg.cybersource.secretKey)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Invalid CyberSource cryptographic signature.',
    };
  }

  const orderNumber = String(payload.req_reference_number || payload.reference_number || '').trim();
  const decision = String(payload.decision || '').trim().toUpperCase();
  const providerTxId = String(payload.transaction_id || '').trim();
  const reasonCode = String(payload.reason_code || '').trim();
  const authAmountRaw = String(payload.auth_amount || payload.req_amount || '').trim();
  const reqCurrency = String(payload.req_currency || '').trim().toUpperCase();

  if (!orderNumber) {
    return { ok: false, statusCode: 400, error: 'Missing order reference number.' };
  }

  const order = db
    .prepare(
      `
      SELECT id, order_number, total_cents, currency, payment_status, order_status
      FROM orders
      WHERE order_number = ?
      LIMIT 1
    `
    )
    .get(orderNumber) as
    | {
        id: number;
        order_number: string;
        total_cents: number;
        currency: string;
        payment_status: string;
        order_status: string;
      }
    | undefined;

  if (!order) {
    return { ok: false, statusCode: 404, error: 'Referenced order does not exist.' };
  }

  // Idempotency check: if this CyberSource transaction ID was already processed, return current status
  if (providerTxId) {
    const dup = db
      .prepare('SELECT id, order_id, status FROM payments WHERE provider_transaction_id = ? LIMIT 1')
      .get(providerTxId) as { id: number; order_id: number; status: string } | undefined;
    if (dup && dup.order_id === order.id && dup.status === 'Paid') {
      return {
        ok: true,
        statusCode: 200,
        orderNumber: order.order_number,
        paymentStatus: 'Paid',
        transactionId: providerTxId,
      };
    }
  }

  // Validate amount and currency when ACCEPT is reported
  const reportedCents = Math.round(Number(authAmountRaw) * 100);
  if (decision === 'ACCEPT') {
    if (!Number.isFinite(reportedCents) || reportedCents !== order.total_cents) {
      return {
        ok: false,
        statusCode: 400,
        error: 'CyberSource authorized amount does not match server order total.',
      };
    }
    if (reqCurrency && reqCurrency !== (order.currency || 'USD').toUpperCase()) {
      return {
        ok: false,
        statusCode: 400,
        error: 'CyberSource currency does not match order currency.',
      };
    }
  }

  let nextPaymentStatus = 'Failed';
  let nextOrderStatus = order.order_status;

  if (decision === 'ACCEPT') {
    if (isServerWebhook) {
      nextPaymentStatus = 'Paid';
      if (order.order_status === 'Pending') {
        nextOrderStatus = 'Processing';
      }
    } else {
      // Browser return redirect NEVER promotes an unpaid order to Paid
      nextPaymentStatus =
        order.payment_status === 'Paid' ? 'Paid' : 'Awaiting Verification';
    }
  } else if (decision === 'CANCEL') {
    nextPaymentStatus = order.payment_status === 'Paid' ? 'Paid' : 'Cancelled';
  } else if (decision === 'REVIEW') {
    nextPaymentStatus = order.payment_status === 'Paid' ? 'Paid' : 'Awaiting Verification';
  } else {
    nextPaymentStatus = order.payment_status === 'Paid' ? 'Paid' : 'Failed';
  }

  // Store sanitized summary only (never raw PAN/CVN — CyberSource Hosted Checkout never sends full PAN)
  const sanitizedPayload = JSON.stringify({
    decision,
    reason_code: reasonCode,
    transaction_id: providerTxId,
    req_reference_number: orderNumber,
    auth_amount: authAmountRaw,
    req_currency: reqCurrency,
    source: isServerWebhook ? 'webhook' : 'browser_return',
  });

  runInTransaction(db, () => {
    const latestPayment = db
      .prepare(
        `
        SELECT id FROM payments
        WHERE order_id = ? AND method = 'cybersource'
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get(order.id) as { id: number } | undefined;

    if (latestPayment) {
      db.prepare(
        `
        UPDATE payments
        SET
          provider_transaction_id = COALESCE(NULLIF(?, ''), provider_transaction_id),
          status = ?,
          verified_at = CASE WHEN ? = 'Paid' THEN datetime('now') ELSE verified_at END,
          review_note = ?,
          raw_provider_payload = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `
      ).run(
        providerTxId,
        nextPaymentStatus,
        nextPaymentStatus,
        `CyberSource ${isServerWebhook ? 'webhook' : 'return'}: ${decision} (reason ${reasonCode || 'n/a'})`,
        sanitizedPayload,
        latestPayment.id
      );
    } else {
      const paymentRef = `CS-${new Date().getUTCFullYear()}-${generateSecureToken(5).toUpperCase()}`;
      db.prepare(
        `
        INSERT INTO payments (
          payment_ref, order_id, method, provider, currency,
          expected_amount_cents, provider_transaction_id, status,
          verified_at, review_note, raw_provider_payload
        ) VALUES (
          ?, ?, 'cybersource', ?, ?, ?, NULLIF(?, ''), ?,
          CASE WHEN ? = 'Paid' THEN datetime('now') ELSE NULL END,
          ?, ?
        )
      `
      ).run(
        paymentRef,
        order.id,
        `CyberSource Secure Acceptance (${cfg.cybersource.env})`,
        order.currency || 'USD',
        order.total_cents,
        providerTxId,
        nextPaymentStatus,
        nextPaymentStatus,
        `CyberSource ${isServerWebhook ? 'webhook' : 'return'}: ${decision} (reason ${reasonCode || 'n/a'})`,
        sanitizedPayload
      );
    }

    db.prepare(
      `
      UPDATE orders
      SET payment_status = ?, order_status = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(nextPaymentStatus, nextOrderStatus, order.id);
  });

  return {
    ok: true,
    statusCode: 200,
    orderNumber: order.order_number,
    paymentStatus: nextPaymentStatus,
    transactionId: providerTxId || undefined,
  };
}
