// QA 22.09.2026 (acceptance, finding 2): deleting a recipe removed its
// photographs BEFORE asking the server to delete the recipe. When that call
// failed — a dropped connection — the recipe stayed and its pictures were
// gone for good. These tests pin the order: nothing leaves storage until the
// recipe row is gone, and a refused delete leaves every file in place. The
// same rule for a single photo: its row first, its file after.
//
// A hand-rolled client rather than the fake Supabase, because what is under
// test is the ORDER of two calls on two subsystems, and a fake that models
// storage would only hide the sequence this asserts on.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { createSupabaseRepository } from './supabaseRepository.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';
import type { RecipeImage } from './repository.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface Script {
  rpcError?: { message: string; code?: string } | null;
  rowDeleteError?: { message: string } | null;
}

function clientWith(script: Script) {
  const calls: string[] = [];
  const remove = vi.fn(async (paths: string[]) => {
    calls.push(`storage.remove:${paths.join(',')}`);
    return { data: paths.map((name) => ({ name })), error: null };
  });
  const rpc = vi.fn(async (name: string) => {
    calls.push(`rpc:${name}`);
    return { data: null, error: script.rpcError ?? null };
  });
  const from = (table: string) => ({
    select: () => ({
      eq: async () => ({
        data:
          table === 'recipe_images'
            ? [{ storage_path: 'r1/a.webp' }, { storage_path: 'r1/b.webp' }]
            : [],
        error: null,
      }),
    }),
    delete: () => ({
      eq: async () => {
        calls.push(`${table}.delete`);
        return { data: null, error: script.rowDeleteError ?? null };
      },
    }),
  });
  const client = {
    from,
    rpc,
    storage: { from: () => ({ remove }) },
  } as unknown as TypedSupabaseClient;
  return { client, calls, remove, rpc };
}

beforeEach(() => {
  resetMemoryIdb();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('deleting a recipe', () => {
  it('deletes the row FIRST and removes the files only after the server confirmed', async () => {
    const { client, calls } = clientWith({});
    const repo = createSupabaseRepository({ client, userId: USER });
    await repo.deleteRecipe('r1');
    expect(calls).toEqual(['rpc:delete_recipe', 'storage.remove:r1/a.webp,r1/b.webp']);
  });

  it('leaves every photograph in place when the delete is refused', async () => {
    const { client, calls, remove } = clientWith({
      rpcError: { message: 'TypeError: Failed to fetch' },
    });
    const repo = createSupabaseRepository({ client, userId: USER });
    await expect(repo.deleteRecipe('r1')).rejects.toThrow(/מחיקת המתכון נכשלה/);
    expect(remove).not.toHaveBeenCalled();
    expect(calls).toEqual(['rpc:delete_recipe']);
  });
});

describe('removing one photograph', () => {
  const image: RecipeImage = {
    id: 'i1',
    recipeId: 'r1',
    storagePath: 'r1/a.webp',
    width: 10,
    height: 10,
    bytes: 100,
    caption: '',
    ord: 0,
    createdAt: '2026-09-22T00:00:00Z',
    focalX: 50,
    focalY: 50,
  };

  it('removes the row first and the file after', async () => {
    const { client, calls } = clientWith({});
    const repo = createSupabaseRepository({ client, userId: USER });
    await repo.removeRecipeImage(image);
    expect(calls).toEqual(['recipe_images.delete', 'storage.remove:r1/a.webp']);
  });

  it('keeps the file when the row could not be deleted, so the picture stays whole', async () => {
    const { client, remove } = clientWith({ rowDeleteError: { message: 'network' } });
    const repo = createSupabaseRepository({ client, userId: USER });
    await expect(repo.removeRecipeImage(image)).rejects.toThrow(/מחיקת התמונה נכשלה/);
    expect(remove).not.toHaveBeenCalled();
  });
});
