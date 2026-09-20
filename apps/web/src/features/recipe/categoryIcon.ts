// One emblem per category, for the home screen's category tiles.
//
// NEVER INSTEAD OF THE NAME
//
// The brief asks for "קטגוריות ברורות עם אייקונים ושמות" and, in the same
// breath, forbids unlabelled icons. So these are decoration beside a name that
// is always there, they are `aria-hidden`, and a category with no emblem of
// its own is not a problem — it simply shows its name, which was the whole
// answer before.
//
// Categories are free text that the user's own data defines (`categories`
// comes from the notebook), so this maps what the demo and the spec use and
// falls back rather than assuming.

const ICONS: Readonly<Record<string, string>> = {
  בצקים: '🥖',
  לחמים: '🍞',
  'קרמים ומילויים': '🥣',
  'גנאשים ורטבים': '🍫',
  'עוגות ועוגיות': '🍰',
  שוקולד: '🍫',
  מאפים: '🥐',
  קינוחים: '🍮',
  ממרחים: '🫙',
  משקאות: '☕',
  אחר: '📒',
};

export function categoryIcon(category: string): string | null {
  return ICONS[category] ?? null;
}
