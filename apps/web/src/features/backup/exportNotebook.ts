// Backup and export (spec 5.1 "ייצוא וגיבוי"; stage 3ב, A-5).
//
// One JSON file with the whole notebook, built from what the app already
// holds and reads — no new server call shapes, no new policy. It is a COPY
// for the user's own keeping: the file is written to their device and goes
// nowhere else. Import back into the app is not in scope (the spec does not
// ask for it), so the shape is kept simple and self-describing rather than
// designed for a reader that does not exist yet.
//
// WHAT IS LEFT OUT, AND WHY
//   · `versions` — the server's frozen snapshots; a record of edits, not of
//     the recipe, and rebuilt by the server on every save.
//   · `updatedAt` / owner ids — concurrency tokens and account internals.
//   · photographs — binary, in storage, and a signed URL expires; the recipe
//     keeps its captions but the backup names no files.

import type { MeasurementPrefs, Recipe } from '@recipe-notebook/engine';
import type { CatalogItem } from '../pricing/catalog.js';
import type { ProductionPlan } from '../planning/plan.js';

export const BACKUP_FORMAT = 'recipe-notebook-backup';
export const BACKUP_VERSION = 1;

/** Keys the server adds for its own bookkeeping; not the user's data. */
const INTERNAL_RECIPE_KEYS = ['versions', 'updatedAt', 'ownerId', 'owner_id', 'updated_at'] as const;

export interface BackupRecipe extends Omit<Recipe, 'versions'> {
  /** §8: the account's own note, included because the file is the account's */
  privateNote?: string;
}

export interface NotebookBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  account: { email: string | null };
  prefs: MeasurementPrefs | null;
  recipes: BackupRecipe[];
  catalog: CatalogItem[];
  plans: ProductionPlan[];
}

export interface BackupInput {
  recipes: readonly Recipe[];
  catalog: readonly CatalogItem[];
  prefs: MeasurementPrefs | null;
  plans: readonly ProductionPlan[];
  /** recipe id → private note; a recipe absent here has none */
  privateNotes: Readonly<Record<string, string>>;
  email: string | null;
  now?: Date;
}

/** Pure: the file's contents, as an object. */
export function buildNotebookBackup(input: BackupInput): NotebookBackup {
  const recipes = input.recipes.map<BackupRecipe>((r) => {
    const copy: Record<string, unknown> = { ...r };
    for (const k of INTERNAL_RECIPE_KEYS) delete copy[k];
    const note = input.privateNotes[r.id];
    if (note !== undefined && note !== '') copy['privateNote'] = note;
    return copy as unknown as BackupRecipe;
  });
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    account: { email: input.email },
    prefs: input.prefs,
    recipes,
    catalog: [...input.catalog],
    plans: [...input.plans],
  };
}

/**
 * "recipe-notebook-backup-2026-09-23.json".
 *
 * ASCII on purpose: a Hebrew name in the `download` attribute came back as
 * a bare "download" with no extension from Chromium in the QA run
 * (23.09.2026, scripts-spec/s3b-dlname.mjs), and a file the user cannot
 * recognise or open is worse than a name they can read.
 */
export function backupFileName(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `recipe-notebook-backup-${y}-${m}-${d}.json`;
}

/** Hands the browser a file to save. Returns the byte size written. */
export function downloadJson(fileName: string, data: unknown): number {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // After the click has been dispatched; revoking sooner cancels the save
    // in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return blob.size;
}
