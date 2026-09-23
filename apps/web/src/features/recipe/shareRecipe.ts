// "שיתוף" in the recipe's ⋮ menu (spec §8.1, stage 5).
//
// WHAT IS SHARED, AND WHY NOT A LINK
//
// A recipe's address needs the owner's account to open, so a link is useless
// to anyone it is sent to. What is shared is the recipe AS WRITTEN: name,
// what it makes, the ingredients with their written quantities, the steps.
// Nothing computed, nothing priced — costs and margins are the owner's, and
// §3.3 keeps them behind their own button on the page.
//
// The device's own share sheet when it has one (phones do), the clipboard
// when it does not (desktops mostly), and a plain answer either way so the
// menu can say what happened.

import { type Recipe, unitLabel } from '@recipe-notebook/engine';

/** The recipe as text, ready to paste into a message. */
export function recipeShareText(recipe: Recipe): string {
  const lines: string[] = [];
  lines.push(String(recipe.name ?? 'מתכון'));
  const yieldBits: string[] = [];
  if (recipe.yieldUnits) yieldBits.push(`${recipe.yieldUnits} יחידות`);
  if (recipe.unitWeight) yieldBits.push(`${recipe.unitWeight} גר' ליחידה`);
  if (yieldBits.length) lines.push(yieldBits.join(' · '));
  const ings = recipe.ingredients ?? [];
  if (ings.length) {
    lines.push('', 'רכיבים:');
    for (const ing of ings) {
      const qty = ing.qty === undefined || ing.qty === null || ing.qty === '' ? '' : String(ing.qty);
      const unit = qty ? unitLabel(ing.unit) : '';
      lines.push(`- ${[qty, unit, ing.name].filter(Boolean).join(' ')}`);
    }
  }
  const steps = recipe.steps ?? [];
  if (steps.length) {
    lines.push('', 'אופן ההכנה:');
    steps.forEach((s, i) => lines.push(`${i + 1}. ${s.text}`));
  }
  if (recipe.notes) lines.push('', String(recipe.notes));
  return lines.join('\n');
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareRecipe(recipe: Recipe): Promise<ShareOutcome> {
  const text = recipeShareText(recipe);
  const title = String(recipe.name ?? 'מתכון');
  const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch (e) {
      // The user closed the sheet: not a failure, and nothing to copy over it.
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
      /* fall through to the clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
