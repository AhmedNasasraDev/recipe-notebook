/*
  WHERE THE DEMO'S CHANGES GO.

  The shareable demo has no server: it is one HTML file that someone opens from
  their downloads or from a link. What a person creates in it should still be
  there when they come back, so it is written to `localStorage` under a single
  key — one snapshot of the demo's own data, not a sync protocol.

  EVERY ACCESSOR CAN FAIL, AND FAILING IS A STATE THE DEMO SHOWS.

  `localStorage` throws in a private window, with site data blocked, in some
  embedded webviews, and (measured) in Safari for a `file://` page. The demo
  must then keep working for the session and SAY that nothing will survive the
  reload, rather than pretending it saved. That is what `probeStorage` is for:
  it writes and removes a probe key, so the answer is what the browser actually
  did, not what the API looks like.

  NOT FOR PRODUCTION DATA. This file is part of the non-product demo build and
  nothing in `apps/` imports it.
*/

import type { Calibration, MeasurementPrefs, Recipe } from '@recipe-notebook/engine';
import type { CatalogItem } from '../../apps/web/src/features/pricing/catalog.js';
import type { ProductionPlan } from '../../apps/web/src/features/planning/plan.js';

export const DEMO_KEY = 'rn.demo.v1';

export interface DemoSnapshot {
  readonly v: 1;
  readonly savedAt: string;
  readonly recipes: readonly Recipe[];
  readonly prefs: MeasurementPrefs | null;
  readonly calibrations: readonly Calibration[];
  readonly catalog: readonly CatalogItem[];
  readonly plans: readonly ProductionPlan[];
  readonly notes: Readonly<Record<string, string>>;
  /** The name the person gave themselves in the demo's settings, if any. */
  readonly displayName?: string;
}

/** What the browser actually allows, measured rather than assumed. */
export type StorageState = 'ready' | 'unavailable';

export function probeStorage(): StorageState {
  try {
    const probe = `${DEMO_KEY}.probe`;
    window.localStorage.setItem(probe, '1');
    const back = window.localStorage.getItem(probe);
    window.localStorage.removeItem(probe);
    return back === '1' ? 'ready' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function readSnapshot(): DemoSnapshot | null {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoSnapshot;
    // A snapshot from a future version is not guessed at; the demo starts over.
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSnapshot(snapshot: DemoSnapshot): boolean {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    /* Quota, a private window, blocked site data — the session continues in
       memory and the notice already says the saving is local and best effort. */
    return false;
  }
}

export function forgetSnapshot(): void {
  try {
    window.localStorage.removeItem(DEMO_KEY);
  } catch {
    /* nothing to forget, then */
  }
}
