import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSupabase,
  looksLikeServiceRoleKey,
  resetSupabaseForTests,
  supabaseStatus,
} from './supabase.js';

// Every case pins the two env vars explicitly. Reading whatever happens to be
// in the developer's .env.local would make these tests pass or fail depending
// on the machine — which is exactly what happened when the project was first
// provisioned and this file still assumed "no project exists".
afterEach(() => {
  vi.unstubAllEnvs();
  resetSupabaseForTests();
});

const PUBLISHABLE = 'sb_publishable_test_key';
const URL_OK = 'https://example.supabase.co';

function env(url: string | undefined, key: string | undefined) {
  vi.stubEnv('VITE_SUPABASE_URL', url ?? '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', key ?? '');
  resetSupabaseForTests();
}

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '');
const jwt = (role: string) => `${b64({ alg: 'HS256' })}.${b64({ role })}.sig`;

describe('an unconfigured checkout is a normal state, not an error', () => {
  it('reports missing-env when both vars are absent', () => {
    env(undefined, undefined);
    const s = supabaseStatus();
    expect(s.configured).toBe(false);
    if (!s.configured) expect(s.reason).toBe('missing-env');
  });

  it('reports missing-env when only the URL is set', () => {
    env(URL_OK, undefined);
    expect(supabaseStatus().configured).toBe(false);
  });

  it('returns no client, so nothing can accidentally call a server', () => {
    env(undefined, undefined);
    expect(getSupabase()).toBeNull();
  });
});

describe('a configured checkout', () => {
  it('reports the URL and key it will use', () => {
    env(URL_OK, PUBLISHABLE);
    const s = supabaseStatus();
    expect(s.configured).toBe(true);
    if (s.configured) {
      expect(s.config.url).toBe(URL_OK);
      expect(s.config.anonKey).toBe(PUBLISHABLE);
    }
  });

  it('builds one client and reuses it', () => {
    env(URL_OK, PUBLISHABLE);
    const a = getSupabase();
    expect(a).not.toBeNull();
    expect(getSupabase()).toBe(a);
  });
});

describe('HANDOFF §6 — a privileged key must never reach the browser', () => {
  it('recognises a service-role JWT', () => {
    expect(looksLikeServiceRoleKey(jwt('service_role'))).toBe(true);
  });

  it('recognises a modern secret key by its prefix', () => {
    // Not a JWT, so the decode path cannot see it. Caught before the decode.
    expect(looksLikeServiceRoleKey('sb_secret_abc123')).toBe(true);
  });

  it('accepts an anon JWT and a publishable key', () => {
    expect(looksLikeServiceRoleKey(jwt('anon'))).toBe(false);
    expect(looksLikeServiceRoleKey(PUBLISHABLE)).toBe(false);
  });

  it('does not throw on a malformed key', () => {
    expect(looksLikeServiceRoleKey('not-a-jwt')).toBe(false);
    expect(looksLikeServiceRoleKey('')).toBe(false);
  });

  it('refuses to build a client from a service-role key, and says why', () => {
    env(URL_OK, jwt('service_role'));
    const s = supabaseStatus();
    expect(s.configured).toBe(false);
    if (!s.configured) expect(s.reason).toBe('service-role-key-in-browser');
    // The app falls back to the demo repository rather than running privileged.
    expect(getSupabase()).toBeNull();
  });

  it('refuses to build a client from a secret key too', () => {
    env(URL_OK, 'sb_secret_abc123');
    expect(getSupabase()).toBeNull();
  });
});
