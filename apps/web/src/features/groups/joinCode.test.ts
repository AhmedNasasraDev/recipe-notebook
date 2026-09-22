import { describe, expect, it } from 'vitest';
import { generateJoinCode, normaliseJoinCode } from './joinCode.js';

describe('the join code (QA 22.09.2026, finding 7)', () => {
  it('is eight readable characters in two groups', () => {
    const code = generateJoinCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  });

  it('never uses the characters that are misread aloud', () => {
    for (let i = 0; i < 200; i++) expect(generateJoinCode()).not.toMatch(/[01OIL]/);
  });

  it('is deterministic under an injected source', () => {
    expect(generateJoinCode(() => 0)).toBe('AAAA-AAAA');
  });

  it('normalises what was typed: case, spaces, missing dash', () => {
    expect(normaliseJoinCode(' abcd 2345 ')).toBe('ABCD-2345');
    expect(normaliseJoinCode('abcd-2345')).toBe('ABCD-2345');
    // Something that is not a code at all is passed through for the server to refuse.
    expect(normaliseJoinCode('nope')).toBe('nope');
  });
});
