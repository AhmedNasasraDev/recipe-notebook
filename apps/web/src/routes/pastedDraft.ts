// The hand-off from the paste screen to the recipe editor (spec 5.1, stage 3
// A-4). It travels in the router's `location.state` — not in the URL, not in
// storage — so a reload of /recipe/new starts empty rather than replaying a
// paste, and nothing is written anywhere until the editor's own save.

import type { Recipe } from '@recipe-notebook/engine';

/** The version note the editor records when a pasted draft is first saved. */
export const PASTE_VERSION_NOTE = 'יובא מהדבקת טקסט';

export interface PastedDraftState {
  /** A recipe without an id: name, category, ingredients, steps, batch facts. */
  draft: Recipe;
  versionNote: string;
}

/** The pasted draft carried by a navigation, or null when there is none. */
export function pastedDraftFrom(state: unknown): PastedDraftState | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Partial<PastedDraftState>;
  if (!s.draft || typeof s.draft !== 'object') return null;
  return { draft: s.draft, versionNote: typeof s.versionNote === 'string' ? s.versionNote : '' };
}
