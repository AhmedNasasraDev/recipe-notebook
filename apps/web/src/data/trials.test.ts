// Spec stage 3ב, A-6: the trial log is written straight to `trials` under its
// own RLS, in an order that never loses what was typed — new rows first,
// changed rows next, removed rows last — and read back as stored.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { createSupabaseRepository } from './supabaseRepository.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function clientWith(rows: { id: string; date: string | null; note: string }[], failInsert = false) {
  const calls: string[] = [];
  let table = [...rows];
  const from = (name: string) => {
    if (name !== 'trials') throw new Error('unexpected table ' + name);
    return {
      select: () => ({ eq: async () => ({ data: table.map((r) => ({ ...r })), error: null }) }),
      insert: async (list: { recipe_id: string; date: string | null; note: string }[]) => {
        calls.push(`insert:${list.map((r) => r.note).join(',')}`);
        if (failInsert) return { data: null, error: { message: 'network' } };
        table = [...table, ...list.map((r, i) => ({ id: `new-${i + 1}`, date: r.date, note: r.note }))];
        return { data: null, error: null };
      },
      update: (patch: { date: string | null; note: string }) => ({
        eq: (_k: string, id: string) => ({
          eq: async () => {
            calls.push(`update:${id}:${patch.note}`);
            table = table.map((r) => (r.id === id ? { ...r, ...patch } : r));
            return { data: null, error: null };
          },
        }),
      }),
      delete: () => ({
        in: (_k: string, ids: string[]) => ({
          eq: async () => {
            calls.push(`delete:${ids.join(',')}`);
            table = table.filter((r) => !ids.includes(r.id));
            return { data: null, error: null };
          },
        }),
      }),
    };
  };
  return { client: { from } as unknown as TypedSupabaseClient, calls };
}

beforeEach(() => {
  resetMemoryIdb();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('saving the trial log', () => {
  it('inserts the new entry, keeps the old ones, and returns the log newest first', async () => {
    const { client, calls } = clientWith([{ id: 't1', date: '2026-09-12', note: 'ישן' }]);
    const repo = createSupabaseRepository({ client, userId: USER });
    const saved = await repo.saveTrials('r1', [
      { id: 't1', date: '2026-09-12', note: 'ישן' },
      { date: '2026-09-20', note: 'חדש' },
    ]);
    expect(calls).toEqual(['insert:חדש', 'update:t1:ישן']);
    expect(saved.map((t) => t.note)).toEqual(['חדש', 'ישן']);
    expect(saved[0]!.id).toBe('new-1');
  });

  it('deletes only what was removed, and only after the additions are safe', async () => {
    const { client, calls } = clientWith([
      { id: 't1', date: '2026-09-12', note: 'א' },
      { id: 't2', date: '2026-09-20', note: 'ב' },
    ]);
    const repo = createSupabaseRepository({ client, userId: USER });
    const saved = await repo.saveTrials('r1', [{ id: 't2', date: '2026-09-20', note: 'ב' }, { note: 'ג' }]);
    expect(calls).toEqual(['insert:ג', 'update:t2:ב', 'delete:t1']);
    expect(saved.map((t) => t.note)).toEqual(['ב', 'ג']);
  });

  it('stops before deleting anything when the insert fails', async () => {
    const { client, calls } = clientWith([{ id: 't1', date: '2026-09-12', note: 'א' }], true);
    const repo = createSupabaseRepository({ client, userId: USER });
    await expect(repo.saveTrials('r1', [{ note: 'ב' }])).rejects.toThrow(/שמירת יומן הניסויים נכשלה/);
    expect(calls).toEqual(['insert:ב']);
  });

  it('refuses offline, before touching the table', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { client, calls } = clientWith([]);
    const repo = createSupabaseRepository({ client, userId: USER });
    await expect(repo.saveTrials('r1', [{ note: 'x' }])).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
