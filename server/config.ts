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
  adminSecretPath: string;
  adminAccessCookieName: string;
  adminRefreshCookieName: string;
  adminCsrfCookieName: string;
  trustProxy: boolean;
  allowIframePreview: boolean;
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
    storageBucket: string;
  };
  adminBootstrap: {
    email: string;
    password: string;
  };
  telegram: {
    botToken: string;
    chatIds: string[];
  };
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development').trim();
  const isProduction = nodeEnv === 'production';
  const port = Math.max(1, parseInt(process.env.PORT || '3000', 10) || 3000);
  const adminSecretPath = normalizeAdminPath(process.env.ADMIN_SECRET_PATH);

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();
  const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const storageBucket = (process.env.SUPABASE_STORAGE_BUCKET || 'product-images').trim();

  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || '';

  const telegramBotToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const telegramChatIds = (process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    isProduction,
    port,
    adminSecretPath,
    adminAccessCookieName: isProduction ? '__Host-rm_sb_access' : 'rm_sb_access',
    adminRefreshCookieName: isProduction ? '__Host-rm_sb_refresh' : 'rm_sb_refresh',
    adminCsrfCookieName: isProduction ? '__Host-rm_admin_csrf' : 'rm_admin_csrf',
    trustProxy: process.env.TRUST_PROXY === 'true',
    allowIframePreview: process.env.ALLOW_IFRAME_PREVIEW === 'true' || !isProduction,
    supabase: {
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
      serviceRoleKey: supabaseServiceRoleKey,
      storageBucket: storageBucket || 'product-images',
    },
    adminBootstrap: {
      email: adminEmail,
      password: adminPassword,
    },
    telegram: {
      botToken: telegramBotToken,
      chatIds: telegramChatIds,
    },
  };
}

export function isSupabaseConfigured(cfg: AppConfig): boolean {
  return Boolean(cfg.supabase.url && cfg.supabase.anonKey);
}

export function getMissingSupabaseVars(cfg: AppConfig): string[] {
  const missing: string[] = [];
  if (!cfg.supabase.url) missing.push('SUPABASE_URL');
  if (!cfg.supabase.anonKey) missing.push('SUPABASE_ANON_KEY');
  return missing;
}
