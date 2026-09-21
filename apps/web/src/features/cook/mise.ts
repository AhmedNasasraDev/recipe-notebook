/*
  Mise en place — the state of "is everything weighed out?", and nothing else.

  ─────────────────────────────────────────────────────────────────────────────
  WHAT THIS FILE DECIDES

  Which row a tick belongs to, whether the list is complete, and whether ticks
  that were saved earlier may be applied to the list on screen now. That is
  all. It holds no quantities and no arithmetic about them: the rows arrive
  from `compute()`, already scaled, and what they SAY is `rowLabel`'s job.

  WHY A TICK IS KEYED BY THE INGREDIENT AND NOT BY ITS POSITION

  A tick means "this is weighed and on the bench". An ingredient that moves up
  the list is the same ingredient, and a tick that followed the position would
  silently transfer to whatever took its place. `ing.id` is that identity;
  rows without one (older demo data, a row mid-edit) fall back to the index,
  which is the only thing left to key on.

  WHY THE SCALE IS PART OF THE SAVED STATE — THE POINT OF THE WHOLE FILE

  "☑ קמח — 500 גרם" is not a fact about flour, it is a fact about 500 grams of
  it. Come back at ×2 and the same tick would claim a kilo had been weighed
  when half of it is in the bag. So the ticks are saved with the factor they
  were taken at, and a different factor does not restore them — the list comes
  back empty and the gate closes, which is the safe direction. Requirement 5
  ("no stale quantities after a scale change") and requirement 9 ("a new
  preparation inherits nothing") are the same rule seen from two sides.

  WHAT "COMPLETE" MEANS, EXACTLY

  Every row currently on screen is ticked, and there is at least one row. A
  recipe with no ingredients cannot be "prepared", and treating an empty list
  as complete would make the gate open on nothing — see `CookScreen`, which
  says so on the screen instead.
*/

import type { ComputedRow } from '@recipe-notebook/engine';

/** tick key → true. Absent and false both mean "not ready". */
export type MiseTicks = Readonly<Record<string, boolean>>;

/** The identity a tick is stored under. See the header. */
export function miseKeyOf(row: ComputedRow, index: number): string {
  const id = row.ing.id;
  return typeof id === 'string' && id !== '' ? id : `#${index}`;
}

/**
 * The scale the ticks were taken at, as a string that can be compared.
 *
 * Six decimals, because a factor is a division (24 units / 18 in the recipe)
 * and two runs of the same link must produce the same signature — while two
 * genuinely different scales must not collide.
 */
export function miseSignature(factor: number): string {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return f.toFixed(6);
}

export interface MiseState {
  total: number;
  ready: number;
  complete: boolean;
}

export function miseState(rows: readonly ComputedRow[], ticks: MiseTicks): MiseState {
  const total = rows.length;
  let ready = 0;
  rows.forEach((row, i) => {
    if (ticks[miseKeyOf(row, i)] === true) ready += 1;
  });
  return { total, ready, complete: total > 0 && ready === total };
}

/** One tick on or off. Returns a new map; the caller stores it. */
export function toggleMise(ticks: MiseTicks, key: string): Record<string, boolean> {
  const next = { ...ticks };
  if (next[key] === true) delete next[key];
  else next[key] = true;
  return next;
}

/**
 * The ticks that may be shown, given what was saved and the scale in force.
 *
 * A saved run with no signature is from before this stage existed — there were
 * no ticks then, so there is nothing to interpret and nothing to restore.
 */
export function restoreMise(
  saved: { mise?: Record<string, boolean>; miseScale?: string } | null,
  signature: string,
): Record<string, boolean> {
  if (!saved || saved.miseScale !== signature || !saved.mise) return {};
  return { ...saved.mise };
}

/**
 * Is a preparation that was started earlier still started?
 *
 * TWO CONDITIONS, AND THE SECOND ONE CHANGED WITH §7.
 *
 * The flag, because the one thing that starts a preparation is the person
 * pressing the button — a list that came back from storage is not a decision,
 * and reading progress back must never be a way past the stage.
 *
 * And the saved run being THIS batch, which used to mean "the list is complete
 * now". That was right while the stage was a lock: a start made at another
 * scale (whose ticks therefore did not restore) was not a start for the
 * preparation on screen, and completeness was the only proxy available.
 *
 * Since Ahmed's change a cook may start with lines unticked, so completeness
 * says nothing about whether this bake was started — and asking for it would
 * send somebody whose bread is already in the oven back to the weighing list
 * on a reload. The honest condition is the one completeness was standing in
 * for: the saved run was taken at the SAME SCALE. That is a fact about the
 * record and the URL, both of which are known before the recipes load, which
 * is what the old note below was protecting.
 */
export function startedFrom(savedStarted: boolean, sameScale: boolean): boolean {
  return savedStarted && sameScale;
}
