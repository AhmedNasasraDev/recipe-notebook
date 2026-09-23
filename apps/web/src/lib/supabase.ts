// Supabase wiring.
//
// Project qxdpsomelzpvphkhkqrw (eu-central-1), migrations 0001-0005 applied.
// Configuration lives in apps/web/.env.local, which is not committed; the app
// still runs without it, on the local demo repository, and says so.
//
// HANDOFF §6, non-negotiable:
//   • only the anon/publishable key may reach the browser
//   • the service-role key never does
//   • the Claude API key never does either — recipe parsing goes through a
//     server proxy with a per-user rate limit, which is a later stage
//
// A missing configuration is a normal state, not an error: a checkout with no
// .env.local runs on the local demo repository, read-only.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

export type TypedSupabaseClient = SupabaseClient<Database>;

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

function readEnv(): Partial<SupabaseConfig> {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    url: env['VITE_SUPABASE_URL']?.trim() || undefined,
    anonKey: env['VITE_SUPABASE_ANON_KEY']?.trim() || undefined,
  };
}

/**
 * Guards against a privileged key being pasted into the browser env by mistake.
 *
 * Supabase issues two families of keys and this has to catch both:
 *   • legacy JWTs, where the privilege is the `role` claim in the payload
 *   • modern keys, where `sb_secret_…` is the privileged one and
 *     `sb_publishable_…` is the safe one
 *
 * A prefix test comes first, because an `sb_secret_` key is not a JWT and would
 * otherwise fall through the decode and be reported as safe.
 */
export function looksLikeServiceRoleKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  try {
    const [, payload] = key.split('.');
    if (!payload) return false;
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { role?: string };
    return json.role === 'service_role';
  } catch {
    return false;
  }
}

export type SupabaseStatus =
  | { configured: false; reason: 'missing-env' }
  | { configured: false; reason: 'service-role-key-in-browser' }
  | { configured: true; config: SupabaseConfig };

export function supabaseStatus(): SupabaseStatus {
  const { url, anonKey } = readEnv();
  if (!url || !anonKey) return { configured: false, reason: 'missing-env' };
  if (looksLikeServiceRoleKey(anonKey)) {
    return { configured: false, reason: 'service-role-key-in-browser' };
  }
  return { configured: true, config: { url, anonKey } };
}

let client: TypedSupabaseClient | null = null;

/**
 * The shared client, or null when Supabase is not configured.
 * Created lazily so that importing this module never performs network setup.
 */
export function getSupabase(): TypedSupabaseClient | null {
  const status = supabaseStatus();
  if (!status.configured) return null;
  if (!client) {
    client = createClient<Database>(status.config.url, status.config.anonKey, {
      auth: {
        // §2: the onboarding runs after the first sign-up and writes to profiles.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/** Test seam — drops the memoised client. */
export function resetSupabaseForTests(): void {
  client = null;
}
