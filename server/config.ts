import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

function normalizeAdminPath(raw: string | undefined): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!cleaned) return '';
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(cleaned)) {
    return '';
  }
  return cleaned;
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  appUrl: string;
  databasePath: string;
  adminSecretPath: string;
  adminSessionTtlMinutes: number;
  adminPasswordResetTtlMinutes: number;
  adminCookieName: string;
  trustProxy: boolean;
  allowIframePreview: boolean;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  cybersource: {
    env: 'test' | 'live';
    merchantId: string;
    profileId: string;
    accessKey: string;
    secretKey: string;
    hostedCheckoutUrl: string;
  };
  crypto: {
    webhookSecret: string;
    rateApiUrl: string;
    enableLiveRates: boolean;
    btcExplorerApiUrl: string;
    ethRpcUrl: string;
    trongridApiKey: string;
    invoiceTtlMinutes: number;
    btcConfirmations: number;
    ethConfirmations: number;
    usdtConfirmations: number;
  };
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development').trim();
  const isProduction = nodeEnv === 'production';
  const port = Math.max(1, parseInt(process.env.PORT || '3000', 10) || 3000);
  const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const databasePath = process.env.DATABASE_PATH
    ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
    : path.resolve(process.cwd(), 'data', 'retromarket.sqlite');

  const adminSecretPath = normalizeAdminPath(process.env.ADMIN_SECRET_PATH);
  const csEnv = (process.env.CYBERSOURCE_ENV || 'test').toLowerCase() === 'live' ? 'live' : 'test';

  return {
    nodeEnv,
    isProduction,
    port,
    appUrl,
    databasePath,
    adminSecretPath,
    adminSessionTtlMinutes: Math.max(
      15,
      parseInt(process.env.ADMIN_SESSION_TTL_MINUTES || '120', 10) || 120
    ),
    adminPasswordResetTtlMinutes: Math.max(
      10,
      parseInt(process.env.ADMIN_RESET_TTL_MINUTES || '20', 10) || 20
    ),
    adminCookieName: isProduction ? '__Host-rm_admin_sid' : 'rm_admin_sid',
    trustProxy: process.env.TRUST_PROXY === 'true',
    allowIframePreview: process.env.ALLOW_IFRAME_PREVIEW === 'true' || !isProduction,
    smtp: {
      host: (process.env.SMTP_HOST || '').trim(),
      port: parseInt(process.env.SMTP_PORT || '587', 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      user: (process.env.SMTP_USER || '').trim(),
      pass: (process.env.SMTP_PASS || '').trim(),
      from: (process.env.SMTP_FROM || '').trim(),
    },
    cybersource: {
      env: csEnv,
      merchantId: (process.env.CYBERSOURCE_MERCHANT_ID || '').trim(),
      profileId: (process.env.CYBERSOURCE_PROFILE_ID || '').trim(),
      accessKey: (process.env.CYBERSOURCE_ACCESS_KEY || '').trim(),
      secretKey: (process.env.CYBERSOURCE_SECRET_KEY || '').trim(),
      hostedCheckoutUrl:
        csEnv === 'live'
          ? 'https://secureacceptance.cybersource.com/pay'
          : 'https://testsecureacceptance.cybersource.com/pay',
    },
    crypto: {
      webhookSecret: (process.env.CRYPTO_WEBHOOK_SECRET || '').trim(),
      rateApiUrl: (
        process.env.CRYPTO_RATE_API_URL ||
        'https://api.coingecko.com/api/v3/simple/price'
      ).trim(),
      enableLiveRates: process.env.CRYPTO_ENABLE_LIVE_RATES === 'true',
      btcExplorerApiUrl: (process.env.BTC_EXPLORER_API_URL || '').trim().replace(/\/+$/, ''),
      ethRpcUrl: (process.env.ETH_RPC_URL || '').trim(),
      trongridApiKey: (process.env.TRONGRID_API_KEY || '').trim(),
      invoiceTtlMinutes: Math.max(
        10,
        parseInt(process.env.CRYPTO_INVOICE_TTL_MINUTES || '30', 10) || 30
      ),
      btcConfirmations: Math.max(1, parseInt(process.env.CRYPTO_BTC_CONFIRMATIONS || '2', 10) || 2),
      ethConfirmations: Math.max(1, parseInt(process.env.CRYPTO_ETH_CONFIRMATIONS || '12', 10) || 12),
      usdtConfirmations: Math.max(
        1,
        parseInt(process.env.CRYPTO_USDT_CONFIRMATIONS || '12', 10) || 12
      ),
    },
  };
}

export function getMissingCyberSourceVars(cfg: AppConfig): string[] {
  const missing: string[] = [];
  if (!cfg.cybersource.merchantId) missing.push('CYBERSOURCE_MERCHANT_ID');
  if (!cfg.cybersource.profileId) missing.push('CYBERSOURCE_PROFILE_ID');
  if (!cfg.cybersource.accessKey) missing.push('CYBERSOURCE_ACCESS_KEY');
  if (!cfg.cybersource.secretKey) missing.push('CYBERSOURCE_SECRET_KEY');
  return missing;
}

export function getMissingSmtpVars(cfg: AppConfig): string[] {
  const missing: string[] = [];
  if (!cfg.smtp.host) missing.push('SMTP_HOST');
  if (!cfg.smtp.user) missing.push('SMTP_USER');
  if (!cfg.smtp.pass) missing.push('SMTP_PASS');
  if (!cfg.smtp.from) missing.push('SMTP_FROM');
  return missing;
}

export function getCryptoVerifierStatus(cfg: AppConfig) {
  return {
    liveRatesEnabled: cfg.crypto.enableLiveRates,
    webhookConfigured: Boolean(cfg.crypto.webhookSecret),
    btcVerifierConfigured: Boolean(cfg.crypto.btcExplorerApiUrl),
    ethVerifierConfigured: Boolean(cfg.crypto.ethRpcUrl),
    usdtVerifierConfigured: Boolean(cfg.crypto.ethRpcUrl || cfg.crypto.trongridApiKey),
  };
}
