import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canResend,
  canRevoke,
  daysLeft,
  inviteLink,
  inviteState,
  isLive,
  looksLikeEmail,
  normalizeEmail,
} from './invites.js';

const MIGRATIONS = join(import.meta.dirname, '../../../../../supabase/migrations');
const sql0030 = readFileSync(join(MIGRATIONS, '0030_roles_and_invitation_lifecycle.sql'), 'utf8');
const sql0031 = readFileSync(join(MIGRATIONS, '0031_invitations_and_identity.sql'), 'utf8');

const NOW = new Date('2026-09-17T12:00:00Z');
const invite = (status: string, expires: string) =>
  ({ status, expiresAt: expires }) as Parameters<typeof inviteState>[0];

describe('inviteState agrees with public.invite_state', () => {
  it('derives expiry rather than reading a stored status', () => {
    // The SQL: a non-pending status stands, otherwise now() decides.
    const body = sql0030.slice(sql0030.indexOf('function public.invite_state'));
    expect(body).toMatch(/when p_invite\.status <> 'pending' then p_invite\.status/);
    expect(body).toMatch(/expires_at <=/);
    // And there is no such column to read.
    expect(sql0030).not.toMatch(/check \(status in \([^)]*'expired'/);
  });

  it('calls a pending invitation past its date expired', () => {
    expect(inviteState(invite('pending', '2026-09-17T11:59:59Z'), NOW)).toBe('expired');
  });

  it('calls a pending invitation inside its window pending', () => {
    expect(inviteState(invite('pending', '2026-09-24T12:00:00Z'), NOW)).toBe('pending');
  });

  it('treats the exact expiry moment as expired, as `<=` in the SQL does', () => {
    expect(inviteState(invite('pending', '2026-09-17T12:00:00Z'), NOW)).toBe('expired');
  });

  it('leaves a decided status alone even when the date has passed', () => {
    // An accepted invitation does not become "expired" a week later — what
    // happened to it is more informative than when it would have lapsed.
    expect(inviteState(invite('accepted', '2020-01-01T00:00:00Z'), NOW)).toBe('accepted');
    expect(inviteState(invite('revoked', '2020-01-01T00:00:00Z'), NOW)).toBe('revoked');
    expect(inviteState(invite('rejected', '2020-01-01T00:00:00Z'), NOW)).toBe('rejected');
  });
});

describe('what the buttons may offer', () => {
  it('offers resend for everything except an invitation already used', () => {
    expect(canResend('accepted')).toBe(false);
    for (const s of ['pending', 'expired', 'revoked', 'rejected'] as const) {
      expect(canResend(s)).toBe(true);
    }
    // ...which is exactly the one case the RPC refuses.
    const body = sql0031.slice(sql0031.indexOf('function public.resend_group_invite'));
    expect(body).toMatch(/if v_old\.status = 'accepted' then/);
    expect(body).not.toMatch(/if v_old\.status = 'revoked' then\s+raise/);
  });

  it('offers revoke only for a live invitation, as the UPDATE filters', () => {
    expect(canRevoke('pending')).toBe(true);
    for (const s of ['accepted', 'expired', 'revoked', 'rejected'] as const) {
      expect(canRevoke(s)).toBe(false);
    }
    const body = sql0031.slice(sql0031.indexOf('function public.revoke_group_invite'));
    expect(body).toMatch(/where id = p_invite_id\s*\n\s*and status = 'pending'/);
  });

  it('only calls a pending invitation live, so no dead link is ever copied', () => {
    expect(isLive('pending')).toBe(true);
    expect(isLive('expired')).toBe(false);
  });
});

describe('inviteLink', () => {
  it('builds the route the app registers', () => {
    expect(inviteLink('abc123', 'https://example.com')).toBe('https://example.com/join/abc123');
  });

  it('does not double the slash when the origin carries one', () => {
    expect(inviteLink('abc123', 'https://example.com/')).toBe('https://example.com/join/abc123');
  });
});

describe('the email helpers', () => {
  it('normalises the way normalize_email does — trim and lower-case', () => {
    expect(normalizeEmail('  Ahmed@Example.COM ')).toBe('ahmed@example.com');
    const body = sql0030.slice(sql0030.indexOf('function public.normalize_email'));
    expect(body).toMatch(/lower/);
    expect(body).toMatch(/btrim|trim/);
  });

  it('turns an empty address into null, which is what "open link" means', () => {
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
  });

  it('rejects the obvious non-addresses and accepts an ordinary one', () => {
    expect(looksLikeEmail('ahmed@example.com')).toBe(true);
    expect(looksLikeEmail('ahmed@example')).toBe(false);
    expect(looksLikeEmail('ahmed example.com')).toBe(false);
    expect(looksLikeEmail('@example.com')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });
});

describe('daysLeft', () => {
  it('rounds up, so the last part-day still counts as a day', () => {
    expect(daysLeft('2026-09-18T00:00:00Z', NOW)).toBe(1);
    expect(daysLeft('2026-09-24T12:00:00Z', NOW)).toBe(7);
  });

  it('never goes negative — an expired invitation has zero days, not -3', () => {
    expect(daysLeft('2026-09-14T12:00:00Z', NOW)).toBe(0);
  });
});
