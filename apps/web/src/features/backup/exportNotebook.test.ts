// Spec 5.1 backup (stage 3ב, A-5): the file holds the user's data and nothing
// of the server's bookkeeping, and names itself by the day it was made.

import { describe, expect, it, vi } from 'vitest';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  buildNotebookBackup,
  downloadJson,
} from './exportNotebook.js';

const BRIOCHE = {
  id: 'r1',
  name: 'בריוש',
  category: 'לחמים',
  ingredients: [{ id: 'i1', name: 'קמח לחם', qty: 500, unit: 'g' }],
  steps: [{ id: 's1', text: 'ללוש' }],
  trials: [{ id: 't1', date: '2026-09-20', note: 'קרום כהה מדי' }],
  versions: [{ tag: 'v1', at: '2026-09-01' }],
  updatedAt: '2026-09-22T10:00:00Z',
} as unknown as Recipe;

describe('the backup file', () => {
  it('carries the recipes with their trials and notes, minus the server internals', () => {
    const b = buildNotebookBackup({
      recipes: [BRIOCHE],
      catalog: [],
      prefs: defaultPrefs('pro'),
      plans: [],
      privateNotes: { r1: 'רק לי: להוסיף וניל' },
      email: 'me@example.com',
      now: new Date('2026-09-23T08:00:00Z'),
    });
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.version).toBe(BACKUP_VERSION);
    expect(b.exportedAt).toBe('2026-09-23T08:00:00.000Z');
    expect(b.account.email).toBe('me@example.com');
    expect(b.recipes).toHaveLength(1);
    const r = b.recipes[0]!;
    expect(r.name).toBe('בריוש');
    expect(r.ingredients).toHaveLength(1);
    expect(r.trials).toEqual([{ id: 't1', date: '2026-09-20', note: 'קרום כהה מדי' }]);
    expect(r.privateNote).toBe('רק לי: להוסיף וניל');
    expect('versions' in r).toBe(false);
    expect('updatedAt' in r).toBe(false);
  });

  it('adds no private-note field to a recipe that has none', () => {
    const b = buildNotebookBackup({
      recipes: [BRIOCHE],
      catalog: [],
      prefs: null,
      plans: [],
      privateNotes: {},
      email: null,
    });
    expect('privateNote' in b.recipes[0]!).toBe(false);
  });

  it('does not change the recipe it was built from', () => {
    const before = JSON.stringify(BRIOCHE);
    buildNotebookBackup({ recipes: [BRIOCHE], catalog: [], prefs: null, plans: [], privateNotes: {}, email: null });
    expect(JSON.stringify(BRIOCHE)).toBe(before);
  });

  it('is named by the local day', () => {
    expect(backupFileName(new Date(2026, 8, 23, 23, 30))).toBe('recipe-notebook-backup-2026-09-23.json');
  });

  it('hands the browser a JSON file under that name', () => {
    const create = vi.fn((_blob: Blob) => 'blob:x');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const size = downloadJson('a.json', { a: 1 });
      expect(size).toBeGreaterThan(0);
      expect(create).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      const blob = create.mock.calls[0]![0];
      expect(blob.type).toMatch(/application\/json/);
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
