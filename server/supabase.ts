import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config.ts';
import { isSupabaseConfigured } from './config.ts';

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file.');
    this.name = 'SupabaseNotConfiguredError';
  }
}

export function createPublicSupabaseClient(cfg: AppConfig): SupabaseClient {
  if (!isSupabaseConfigured(cfg)) {
    throw new SupabaseNotConfiguredError();
  }
  return createClient(cfg.supabase.url, cfg.supabase.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createAuthedSupabaseClient(cfg: AppConfig, accessToken: string): SupabaseClient {
  if (!isSupabaseConfigured(cfg)) {
    throw new SupabaseNotConfiguredError();
  }
  return createClient(cfg.supabase.url, cfg.supabase.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function createServiceRoleSupabaseClient(cfg: AppConfig): SupabaseClient | null {
  if (!cfg.supabase.url || !cfg.supabase.serviceRoleKey) {
    return null;
  }
  return createClient(cfg.supabase.url, cfg.supabase.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function extractStorageObjectPath(cfg: AppConfig, url: string): string | null {
  const raw = String(url || '').trim();
  if (!raw || !cfg.supabase.url) return null;
  const prefix = `${cfg.supabase.url}/storage/v1/object/public/${cfg.supabase.storageBucket}/`;
  if (!raw.startsWith(prefix)) return null;
  const objectPath = decodeURIComponent(raw.slice(prefix.length).split('?')[0]);
  if (!objectPath || objectPath.includes('..') || objectPath.startsWith('/')) {
    return null;
  }
  return objectPath;
}

export function getPublicStorageUrl(cfg: AppConfig, objectPath: string): string {
  const cleanPath = objectPath.replace(/^\/+/, '');
  return `${cfg.supabase.url}/storage/v1/object/public/${cfg.supabase.storageBucket}/${cleanPath}`;
}
