import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config.ts';
import { isSupabaseConfigured } from './config.ts';
import { createServiceRoleSupabaseClient } from './supabase.ts';
import { isValidEmail } from './security.ts';

export interface BootstrapResult {
  provisioned: boolean;
  reason?: string;
}

/**
 * Ensures the initial administrator defined by server-side ADMIN_EMAIL and
 * ADMIN_PASSWORD exists in Supabase Auth (with email confirmed) and is active
 * in public.admin_users.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY strictly on the server. Passwords are
 * managed solely by Supabase Auth and are never stored in plain text.
 */
export async function ensureInitialAdminAccount(
  cfg: AppConfig,
  options?: { syncPassword?: boolean }
): Promise<BootstrapResult> {
  if (!isSupabaseConfigured(cfg)) {
    return { provisioned: false, reason: 'supabase_not_configured' };
  }

  const email = cfg.adminBootstrap.email;
  const password = cfg.adminBootstrap.password;

  if (!email || !password) {
    return { provisioned: false, reason: 'admin_env_not_set' };
  }

  if (!isValidEmail(email) || password.length < 8) {
    console.warn(
      '[RetroMarket] ADMIN_EMAIL or ADMIN_PASSWORD is invalid (valid email and password >= 8 chars required).'
    );
    return { provisioned: false, reason: 'invalid_admin_env' };
  }

  const serviceClient = createServiceRoleSupabaseClient(cfg);
  if (!serviceClient) {
    return { provisioned: false, reason: 'service_role_key_not_set' };
  }

  try {
    // 1. Find existing Supabase Auth user by email (paginated search up to 500 users)
    let existingUser: { id: string; email?: string; email_confirmed_at?: string | null } | null =
      null;
    let page = 1;
    while (page <= 5) {
      const { data, error } = await serviceClient.auth.admin.listUsers({
        page,
        perPage: 100,
      });
      if (error) {
        console.warn('[RetroMarket] Supabase Auth admin listUsers failed:', error.message);
        return { provisioned: false, reason: 'list_users_failed' };
      }
      const users = data?.users || [];
      const found = users.find((u) => String(u.email || '').toLowerCase() === email);
      if (found) {
        existingUser = found;
        break;
      }
      if (users.length < 100) break;
      page += 1;
    }

    let userId = existingUser?.id || '';

    if (!existingUser) {
      // Create the initial administrator securely in Supabase Auth (hashed by GoTrue)
      const { data: created, error: createErr } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: 'super_admin' },
      });
      if (createErr || !created?.user) {
        console.warn(
          '[RetroMarket] Failed to create initial Supabase Auth administrator:',
          createErr?.message || 'unknown error'
        );
        return { provisioned: false, reason: 'create_user_failed' };
      }
      userId = created.user.id;
      console.log(`[RetroMarket] Initial Supabase Auth administrator created for ${email}.`);
    } else if (!existingUser.email_confirmed_at || options?.syncPassword) {
      // Ensure existing initial admin account has confirmed email (and synced password if requested)
      await serviceClient.auth.admin.updateUserById(existingUser.id, {
        email_confirm: true,
        password,
      });
      console.log(`[RetroMarket] Verified/synced initial Supabase Auth administrator ${email}.`);
    }

    if (userId) {
      const { error: upsertErr } = await serviceClient.from('admin_users').upsert(
        {
          user_id: userId,
          email,
          role: 'super_admin',
          active: true,
        },
        { onConflict: 'user_id' }
      );
      if (upsertErr) {
        console.warn(
          '[RetroMarket] Could not sync public.admin_users (ensure supabase/schema.sql has been executed):',
          upsertErr.message
        );
        return { provisioned: false, reason: 'admin_users_upsert_failed' };
      }
    }

    return { provisioned: true };
  } catch (err) {
    console.warn(
      '[RetroMarket] Initial admin bootstrap error:',
      err instanceof Error ? err.message : 'unknown error'
    );
    return { provisioned: false, reason: 'unexpected_error' };
  }
}

/**
 * Ensures an already-authenticated Supabase Auth user whose email matches the
 * configured ADMIN_EMAIL (or when public.admin_users is completely empty) is
 * registered in public.admin_users.
 */
export async function tryAutoAuthorizeAdminRow(
  cfg: AppConfig,
  authedClient: SupabaseClient,
  user: { id: string; email?: string | null }
): Promise<{ user_id: string; email: string; role: string; active: boolean } | null> {
  const userEmail = String(user.email || '').trim().toLowerCase();
  const configuredEmail = cfg.adminBootstrap.email;
  const emailMatchesEnv = Boolean(configuredEmail && userEmail === configuredEmail);

  // 1. If server-side service role key is available and email matches ADMIN_EMAIL, upsert directly
  const serviceClient = createServiceRoleSupabaseClient(cfg);
  if (serviceClient && emailMatchesEnv) {
    const { data, error } = await serviceClient
      .from('admin_users')
      .upsert(
        {
          user_id: user.id,
          email: userEmail,
          role: 'super_admin',
          active: true,
        },
        { onConflict: 'user_id' }
      )
      .select('user_id, email, role, active')
      .maybeSingle();
    if (!error && data) {
      return data as { user_id: string; email: string; role: string; active: boolean };
    }
  }

  // 2. Otherwise, if ADMIN_EMAIL matches (or no ADMIN_EMAIL is pinned), try the
  //    one-time SECURITY DEFINER bootstrap_first_admin() RPC (only succeeds when admin_users has 0 rows)
  if (!configuredEmail || emailMatchesEnv) {
    const { data: rpcData, error: rpcErr } = await authedClient.rpc('bootstrap_first_admin');
    if (!rpcErr && rpcData && typeof rpcData === 'object') {
      const row = rpcData as Record<string, unknown>;
      if (row.user_id && row.active) {
        return {
          user_id: String(row.user_id),
          email: String(row.email || userEmail),
          role: String(row.role || 'super_admin'),
          active: true,
        };
      }
    }
  }

  return null;
}
