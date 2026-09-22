import { describe, expect, it } from 'vitest';
import { describeCause } from './errorText.js';

describe('describeCause (QA 22.09.2026, findings 13 and 14)', () => {
  it('turns a dropped connection into Hebrew', () => {
    expect(describeCause(new TypeError('Failed to fetch'))).toContain('אין חיבור לשרת');
    expect(describeCause({ message: 'TypeError: Failed to fetch' })).toContain('אין חיבור לשרת');
  });

  it('keeps a refusal the server wrote in Hebrew', () => {
    expect(describeCause({ code: 'P0001', message: 'הקוד אינו מתאים לשום קבוצה' })).toBe(
      'הקוד אינו מתאים לשום קבוצה',
    );
  });

  it('names a permission refusal and a duplicate', () => {
    expect(describeCause({ code: '42501', message: 'new row violates row-level security policy' })).toContain('הרשאה');
    expect(describeCause({ code: '23505', message: 'duplicate key value' })).toContain('כבר קיימת');
  });

  it('wraps a PostgREST failure with its code', () => {
    expect(describeCause({ code: 'PGRST201', message: 'Could not embed' })).toContain('PGRST201');
  });

  it('is empty for nothing, and leads an unknown English message with Hebrew', () => {
    expect(describeCause(null)).toBe('');
    expect(describeCause(new Error('boom'))).toMatch(/^השרת החזיר שגיאה: boom$/);
  });
});
