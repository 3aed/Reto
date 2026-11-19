import crypto from 'node:crypto';
import type { AppConfig } from '../config.ts';
import type { DbConnection } from '../db.ts';
import { runInTransaction } from '../db.ts';
import { generateSecureToken, timingSafeEqualStr } from '../security.ts';

export type SupportedCryptoCoin = 'BTC' | 'ETH' | 'USDT';

interface WalletConfig {
  coin: SupportedCryptoCoin;
  name: string;
  network: string;
  address: string;
  requiredConfirmations: number;
}

export function getConfiguredCryptoWallets(
  db: DbConnection,
  cfg: AppConfig
): Record<SupportedCryptoCoin, WalletConfig> {
  const settings = db
    .prepare(
      'SELECT btc_wallet_address, eth_wallet_address, usdt_wallet_address, usdt_network FROM website_settings WHERE id = 1'
    )
    .get() as
    | {
        btc_wallet_address: string;
        eth_wallet_address: string;
        usdt_wallet_address: string;
        usdt_network: string;
      }
    | undefined;

  const btcAddr = (process.env.CRYPTO_BTC_WALLET || settings?.btc_wallet_address || '').trim();
  const ethAddr = (process.env.CRYPTO_ETH_WALLET || settings?.eth_wallet_address || '').trim();
  const usdtAddr = (process.env.CRYPTO_USDT_WALLET || settings?.usdt_wallet_address || '').trim();
  const usdtNetwork = (
    process.env.CRYPTO_USDT_NETWORK ||
    settings?.usdt_network ||
    'ERC-20'
  ).trim();

  return {
    BTC: {
      coin: 'BTC',
      name: 'Bitcoin',
      network: 'Bitcoin Mainnet',
      address: btcAddr,
      requiredConfirmations: cfg.crypto.btcConfirmations,
    },
    ETH: {
      coin: 'ETH',
      name: 'Ethereum',
      network: 'Ethereum Mainnet',
      address: ethAddr,
      requiredConfirmations: cfg.crypto.ethConfirmations,
    },
    USDT: {
      coin: 'USDT',
      name: 'Tether USD',
      network: usdtNetwork,
      address: usdtAddr,
      requiredConfirmations: cfg.crypto.usdtConfirmations,
    },
  };
}

export function validateCryptoTxHashFormat(coin: SupportedCryptoCoin, txHash: string): boolean {
  const trimmed = txHash.trim();
  if (coin === 'BTC') {
    return /^[0-9a-fA-F]{64}$/.test(trimmed);
  }
  if (coin === 'ETH') {
    return /^0x[0-9a-fA-F]{64}$/.test(trimmed);
  }
  // USDT supports ERC-20 (0x + 64 hex) or TRC-20 (64 hex)
  return /^(0x)?[0-9a-fA-F]{64}$/.test(trimmed);
}

async function fetchLiveCryptoRate(
  cfg: AppConfig,
  coin: SupportedCryptoCoin,
  fiatCurrency: string
): Promise<{ ok: true; rate: number } | { ok: false; error: string }> {
  if (!cfg.crypto.enableLiveRates) {
    return {
      ok: false,
      error:
        'Live cryptocurrency exchange-rate quoting is disabled. Set CRYPTO_ENABLE_LIVE_RATES=true (and configure a verified merchant wallet and blockchain verifier/webhook) to issue live crypto invoices.',
    };
  }

  const idMap: Record<SupportedCryptoCoin, string> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    USDT: 'tether',
  };
  const vs = fiatCurrency.toLowerCase();
  const url = `${cfg.crypto.rateApiUrl}?ids=${encodeURIComponent(idMap[coin])}&vs_currencies=${encodeURIComponent(vs)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      return { ok: false, error: `Exchange rate provider returned HTTP ${resp.status}.` };
    }
    const json = (await resp.json()) as Record<string, Record<string, number>>;
    const rate = json?.[idMap[coin]]?.[vs];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      return { ok: false, error: 'Exchange rate provider returned an invalid rate.' };
    }
    return { ok: true, rate };
  } catch {
    return { ok: false, error: 'Unable to reach live cryptocurrency exchange rate provider.' };
  }
}

export async function createCryptoInvoice(
  db: DbConnection,
  cfg: AppConfig,
  params: { orderNumber: string; customerEmail: string; coin: string }
): Promise<
  | {
      ok: true;
      invoice: {
        paymentRef: string;
        orderNumber: string;
        coin: SupportedCryptoCoin;
        network: string;
        walletAddress: string;
        fiatAmount: number;
        fiatCurrency: string;
        cryptoAmount: string;
        requiredConfirmations: number;
        expiresAt: string;
        status: string;
      };
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
    }
> {
  const coinUpper = String(params.coin || '').trim().toUpperCase();
  if (coinUpper !== 'BTC' && coinUpper !== 'ETH' && coinUpper !== 'USDT') {
    return { ok: false, statusCode: 400, error: 'Supported cryptocurrencies are BTC, ETH, and USDT.' };
  }
  const coin = coinUpper as SupportedCryptoCoin;

  const wallets = getConfiguredCryptoWallets(db, cfg);
  const wallet = wallets[coin];
  if (!wallet.address) {
    return {
      ok: false,
      statusCode: 503,
      error: `No real merchant ${coin} wallet address has been configured. An administrator must configure a verified ${coin} wallet address in Website Settings or environment variables before accepting ${coin} payments.`,
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
    return { ok: false, statusCode: 409, error: 'This order is already paid.' };
  }

  if (order.order_status === 'Cancelled') {
    return { ok: false, statusCode: 409, error: 'Cancelled orders cannot generate payment invoices.' };
  }

  const fiatCurrency = (order.currency || 'USD').toUpperCase();
  const fiatAmount = order.total_cents / 100;
  const rateResp = await fetchLiveCryptoRate(cfg, coin, fiatCurrency);
  if (!rateResp.ok) {
    return { ok: false, statusCode: 503, error: rateResp.error };
  }

  const decimals = coin === 'USDT' ? 2 : coin === 'ETH' ? 6 : 8;
  const cryptoAmount = (fiatAmount / rateResp.rate).toFixed(decimals);
  const paymentRef = `CR-${coin}-${generateSecureToken(5).toUpperCase()}`;
  const expiresAtIso = new Date(Date.now() + cfg.crypto.invoiceTtlMinutes * 60 * 1000).toISOString();
  const expiresAtSql = expiresAtIso.replace('T', ' ').slice(0, 19);

  runInTransaction(db, () => {
    db.prepare(
      `
      INSERT INTO payments (
        payment_ref, order_id, method, provider, currency,
        expected_amount_cents, crypto_currency, crypto_expected_amount,
        crypto_wallet_address, crypto_network, required_confirmations,
        status, expires_at, review_note
      ) VALUES (?, ?, 'cryptocurrency', 'Direct On-Chain Invoice', ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)
    `
    ).run(
      paymentRef,
      order.id,
      fiatCurrency,
      order.total_cents,
      coin,
      cryptoAmount,
      wallet.address,
      wallet.network,
      wallet.requiredConfirmations,
      expiresAtSql,
      `Quoted at ${rateResp.rate} ${fiatCurrency}/${coin}`
    );

    db.prepare(
      `
      UPDATE orders
      SET payment_method = 'cryptocurrency', updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(order.id);
  });

  return {
    ok: true,
    invoice: {
      paymentRef,
      orderNumber: order.order_number,
      coin,
      network: wallet.network,
      walletAddress: wallet.address,
      fiatAmount,
      fiatCurrency,
      cryptoAmount,
      requiredConfirmations: wallet.requiredConfirmations,
      expiresAt: expiresAtIso,
      status: 'Pending',
    },
  };
}

interface OnChainVerificationResult {
  verifierConfigured: boolean;
  verifiedPaid: boolean;
  confirmations: number;
  note: string;
}

/**
 * Attempts real on-chain verification against a configured explorer/RPC node.
 * NEVER fabricates confirmations or approves unverified transactions.
 */
async function verifyOnChainTransaction(
  cfg: AppConfig,
  params: {
    coin: SupportedCryptoCoin;
    txHash: string;
    expectedAddress: string;
    expectedAmount: string;
    requiredConfirmations: number;
  }
): Promise<OnChainVerificationResult> {
  if (params.coin === 'BTC' && cfg.crypto.btcExplorerApiUrl) {
    try {
      const txResp = await fetch(`${cfg.crypto.btcExplorerApiUrl}/tx/${encodeURIComponent(params.txHash)}`);
      if (!txResp.ok) {
        return {
          verifierConfigured: true,
          verifiedPaid: false,
          confirmations: 0,
          note: `Transaction not found on BTC explorer (HTTP ${txResp.status}).`,
        };
      }
      const txData = (await txResp.json()) as {
        status?: { confirmed?: boolean; block_height?: number };
        vout?: Array<{ scriptpubkey_address?: string; value?: number }>;
      };
      const expectedSats = Math.round(Number(params.expectedAmount) * 1e8);
      const matchedSats = (txData.vout || [])
        .filter((o) => o.scriptpubkey_address === params.expectedAddress)
        .reduce((sum, o) => sum + (Number(o.value) || 0), 0);

      if (matchedSats < expectedSats) {
        return {
          verifierConfigured: true,
          verifiedPaid: false,
          confirmations: 0,
          note: `On-chain output to merchant address (${matchedSats} sats) is below expected (${expectedSats} sats).`,
        };
      }

      if (!txData.status?.confirmed || !txData.status?.block_height) {
        return {
          verifierConfigured: true,
          verifiedPaid: false,
          confirmations: 0,
          note: 'Transaction found in mempool (0 confirmations). Waiting for block confirmations.',
        };
      }

      const tipResp = await fetch(`${cfg.crypto.btcExplorerApiUrl}/blocks/tip/height`);
      const tipHeight = tipResp.ok ? parseInt(await tipResp.text(), 10) : 0;
      const confirmations = tipHeight > 0 ? Math.max(1, tipHeight - txData.status.block_height + 1) : 1;

      if (confirmations >= params.requiredConfirmations) {
        return {
          verifierConfigured: true,
          verifiedPaid: true,
          confirmations,
          note: `Verified on-chain via BTC explorer (${confirmations} confirmations, ${matchedSats} sats).`,
        };
      }

      return {
        verifierConfigured: true,
        verifiedPaid: false,
        confirmations,
        note: `On-chain output matched (${confirmations}/${params.requiredConfirmations} confirmations).`,
      };
    } catch {
      return {
        verifierConfigured: true,
        verifiedPaid: false,
        confirmations: 0,
        note: 'BTC blockchain explorer could not be reached; status remains Awaiting Verification.',
      };
    }
  }

  if (params.coin === 'ETH' && cfg.crypto.ethRpcUrl) {
    try {
      const rpcCall = async (method: string, rpcParams: unknown[]) => {
        const resp = await fetch(cfg.crypto.ethRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: rpcParams }),
        });
        if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
        return (await resp.json()) as { result?: Record<string, string> | string | null };
      };

      const txRes = await rpcCall('eth_getTransactionByHash', [params.txHash]);
      const receiptRes = await rpcCall('eth_getTransactionReceipt', [params.txHash]);
      const blockRes = await rpcCall('eth_blockNumber', []);

      const txObj = txRes.result as Record<string, string> | null;
      const receiptObj = receiptRes.result as Record<string, string> | null;
      if (!txObj || !receiptObj) {
        return {
          verifierConfigured: true,
          verifiedPaid: false,
          confirmations: 0,
          note: 'Ethereum transaction not yet mined or not found on RPC node.',
        };
      }

      if (receiptObj.status !== '0x1') {
        return {
          verifierConfigured: true,
          verifiedPaid: false,
          confirmations: 0,
          note: 'Ethereum transaction reverted on-chain.',
        };
      }

      if (String(txObj.to || '').toLowerCase() !== params.expectedAddress.toLowerCase()) {
        return {
          verifierConfigured: true,
          verifiedPaid: false,
          confirmations: 0,
          note: 'Ethereum transaction recipient does not match configured merchant wallet.',
        };
      }

      const valueWei = BigInt(txObj.value || '0x0');
      const expectedWei = BigInt(Math.round(Number(params.expectedAmount) * 1e6)) * 1000000000000n;
      if (valueWei < expectedWei) {
        return {
          verifierConfigured: true,
          verifiedPaid: false,
          confirmations: 0,
          note: 'Ethereum transaction value is below expected invoice amount.',
        };
      }

      const latestBlock = parseInt(String(blockRes.result || '0x0'), 16);
      const txBlock = parseInt(String(receiptObj.blockNumber || '0x0'), 16);
      const confirmations = latestBlock >= txBlock && txBlock > 0 ? latestBlock - txBlock + 1 : 0;

      if (confirmations >= params.requiredConfirmations) {
        return {
          verifierConfigured: true,
          verifiedPaid: true,
          confirmations,
          note: `Verified on-chain via Ethereum RPC (${confirmations} confirmations).`,
        };
      }
      return {
        verifierConfigured: true,
        verifiedPaid: false,
        confirmations,
        note: `Ethereum transfer matched (${confirmations}/${params.requiredConfirmations} confirmations).`,
      };
    } catch {
      return {
        verifierConfigured: true,
        verifiedPaid: false,
        confirmations: 0,
        note: 'Ethereum RPC node could not be reached; status remains Awaiting Verification.',
      };
    }
  }

  return {
    verifierConfigured: false,
    verifiedPaid: false,
    confirmations: 0,
    note:
      'Transaction hash recorded as Awaiting Verification. Configure a blockchain verifier (BTC_EXPLORER_API_URL / ETH_RPC_URL) or signed payment processor webhook (CRYPTO_WEBHOOK_SECRET) to confirm settlement.',
  };
}

export async function submitCryptoTransactionHash(
  db: DbConnection,
  cfg: AppConfig,
  params: {
    orderNumber: string;
    customerEmail: string;
    paymentRef?: string;
    coin?: string;
    txHash: string;
  }
): Promise<
  | {
      ok: true;
      paymentRef: string;
      status: string;
      confirmations: number;
      verifierConfigured: boolean;
      message: string;
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
    }
> {
  const txHash = String(params.txHash || '').trim();
  if (!txHash) {
    return { ok: false, statusCode: 400, error: 'Transaction hash is required.' };
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
    return { ok: false, statusCode: 409, error: 'This order has already been settled as Paid.' };
  }

  // Locate active crypto invoice
  const invoice = params.paymentRef
    ? (db
        .prepare(
          `
          SELECT * FROM payments
          WHERE payment_ref = ? AND order_id = ? AND method = 'cryptocurrency'
          LIMIT 1
        `
        )
        .get(params.paymentRef.trim(), order.id) as Record<string, unknown> | undefined)
    : (db
        .prepare(
          `
          SELECT * FROM payments
          WHERE order_id = ? AND method = 'cryptocurrency'
          ORDER BY id DESC
          LIMIT 1
        `
        )
        .get(order.id) as Record<string, unknown> | undefined);

  if (!invoice) {
    return {
      ok: false,
      statusCode: 400,
      error:
        'No active cryptocurrency invoice exists for this order. Generate a cryptocurrency payment invoice first.',
    };
  }

  // Reject expired invoices
  const expiresAtStr = String(invoice.expires_at || '');
  if (expiresAtStr) {
    const expiresMs = Date.parse(expiresAtStr.replace(' ', 'T') + 'Z');
    if (Number.isFinite(expiresMs) && Date.now() > expiresMs) {
      db.prepare(
        `UPDATE payments SET status = 'Failed', review_note = 'Invoice expired before verification', updated_at = datetime('now') WHERE id = ? AND status = 'Pending'`
      ).run(Number(invoice.id));
      return {
        ok: false,
        statusCode: 410,
        error: 'This cryptocurrency payment invoice has expired. Please generate a new invoice with a fresh exchange rate.',
      };
    }
  }

  const coin = String(invoice.crypto_currency || params.coin || 'BTC').toUpperCase() as SupportedCryptoCoin;
  if (!validateCryptoTxHashFormat(coin, txHash)) {
    return {
      ok: false,
      statusCode: 400,
      error: `Invalid ${coin} transaction hash format. Please provide the exact 64-character hexadecimal transaction hash.`,
    };
  }

  // Duplicate transaction hash protection across ALL orders
  const duplicate = db
    .prepare('SELECT id, order_id, payment_ref FROM payments WHERE LOWER(tx_hash) = LOWER(?) LIMIT 1')
    .get(txHash) as { id: number; order_id: number; payment_ref: string } | undefined;

  if (duplicate && duplicate.id !== Number(invoice.id)) {
    return {
      ok: false,
      statusCode: 409,
      error: 'This transaction hash has already been submitted on another payment record.',
    };
  }

  const verification = await verifyOnChainTransaction(cfg, {
    coin,
    txHash,
    expectedAddress: String(invoice.crypto_wallet_address || ''),
    expectedAmount: String(invoice.crypto_expected_amount || '0'),
    requiredConfirmations: Number(invoice.required_confirmations || 2),
  });

  const nextStatus = verification.verifiedPaid ? 'Paid' : 'Awaiting Verification';
  const nextOrderStatus =
    verification.verifiedPaid && order.order_status === 'Pending'
      ? 'Processing'
      : order.order_status;

  runInTransaction(db, () => {
    db.prepare(
      `
      UPDATE payments
      SET
        tx_hash = ?,
        confirmations = ?,
        status = ?,
        verified_at = CASE WHEN ? = 'Paid' THEN datetime('now') ELSE verified_at END,
        review_note = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(
      txHash,
      verification.confirmations,
      nextStatus,
      nextStatus,
      verification.note,
      Number(invoice.id)
    );

    db.prepare(
      `
      UPDATE orders
      SET payment_status = ?, order_status = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(nextStatus, nextOrderStatus, order.id);
  });

  return {
    ok: true,
    paymentRef: String(invoice.payment_ref),
    status: nextStatus,
    confirmations: verification.confirmations,
    verifierConfigured: verification.verifierConfigured,
    message: verification.note,
  };
}

export function processCryptoWebhook(
  db: DbConnection,
  cfg: AppConfig,
  rawBody: string,
  signatureHeader: string
): { ok: boolean; statusCode: number; error?: string } {
  if (!cfg.crypto.webhookSecret) {
    return {
      ok: false,
      statusCode: 503,
      error: 'CRYPTO_WEBHOOK_SECRET is not configured on this server.',
    };
  }

  const expectedSig = crypto
    .createHmac('sha256', cfg.crypto.webhookSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const providedSig = signatureHeader.trim().replace(/^sha256=/i, '');
  if (!providedSig || !timingSafeEqualStr(providedSig, expectedSig)) {
    return { ok: false, statusCode: 403, error: 'Invalid cryptocurrency webhook signature.' };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, statusCode: 400, error: 'Malformed JSON webhook payload.' };
  }

  const paymentRef = String(parsed.payment_ref || '').trim();
  const txHash = String(parsed.tx_hash || '').trim();
  const statusRaw = String(parsed.status || '').trim().toLowerCase();
  const confirmations = Math.max(0, parseInt(String(parsed.confirmations || '0'), 10) || 0);

  if (!paymentRef) {
    return { ok: false, statusCode: 400, error: 'Missing payment_ref in webhook payload.' };
  }

  const payment = db
    .prepare("SELECT * FROM payments WHERE payment_ref = ? AND method = 'cryptocurrency' LIMIT 1")
    .get(paymentRef) as Record<string, unknown> | undefined;

  if (!payment) {
    return { ok: false, statusCode: 404, error: 'Referenced cryptocurrency payment not found.' };
  }

  const requiredConf = Number(payment.required_confirmations || 2);
  let nextStatus = 'Awaiting Verification';
  if (statusRaw === 'confirmed' || statusRaw === 'paid') {
    nextStatus = confirmations >= requiredConf ? 'Paid' : 'Awaiting Verification';
  } else if (statusRaw === 'expired' || statusRaw === 'failed') {
    nextStatus = 'Failed';
  } else if (statusRaw === 'cancelled') {
    nextStatus = 'Cancelled';
  }

  runInTransaction(db, () => {
    db.prepare(
      `
      UPDATE payments
      SET
        tx_hash = COALESCE(NULLIF(?, ''), tx_hash),
        confirmations = ?,
        status = ?,
        verified_at = CASE WHEN ? = 'Paid' THEN datetime('now') ELSE verified_at END,
        review_note = ?,
        raw_provider_payload = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(
      txHash,
      confirmations,
      nextStatus,
      nextStatus,
      `Verified crypto webhook (${statusRaw}, ${confirmations}/${requiredConf} confirmations)`,
      rawBody.slice(0, 4000),
      Number(payment.id)
    );

    db.prepare(
      `
      UPDATE orders
      SET
        payment_status = ?,
        order_status = CASE WHEN ? = 'Paid' AND order_status = 'Pending' THEN 'Processing' ELSE order_status END,
        updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(nextStatus, nextStatus, Number(payment.order_id));
  });

  return { ok: true, statusCode: 200 };
}
