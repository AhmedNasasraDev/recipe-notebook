// The join code a group hands out (§6: "קוד קבוצה אינו מעניק חברות — הוא יוצר
// בקשה שדורשת אישור").
//
// QA 22.09.2026, finding 7: `create_group` never set `groups.code`, so every
// group was created with `join_by` including "code" and no code to give
// anybody — the screen had a path that could not work. The code is made
// here, on the client, and written by the owner through the ordinary update
// policy; nothing in the schema changes.
//
// Eight characters from an alphabet with no 0/O, 1/I/L — it is read out loud
// across a classroom — grouped as XXXX-XXXX. That is ~10^12 combinations,
// and a code only creates a request an admin still approves.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateJoinCode(random: (n: number) => number = defaultRandom): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[random(ALPHABET.length)];
    if (i === 3) out += '-';
  }
  return out;
}

function defaultRandom(n: number): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0]! % n;
  }
  return Math.floor(Math.random() * n);
}

/** What a person typed, normalised to the stored form: upper case, one dash. */
export function normaliseJoinCode(typed: string): string {
  const raw = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return typed.trim();
}
