/*
  01 · FIX THE NOTEBOOK BADGES

  What broke: a repaint pass set the chips' fills through a paint whose variable
  lookup had failed, and Figma does not throw for that — it keeps the paint's
  default, which was black. Four cards' plain tags went dark.

  What this does: repaints every chip in the notebook cards by MEANING —
  green for "מתכון בסיס", amber for "נוסחה מאושרת", outline for a plain tag —
  and hides the unused third slot. `pf()` now throws on a bad name, so the same
  failure cannot pass silently again.

  Run order: first. Frame: "טלפון · מחברת המתכונים" (phone slot 0).
*/
// @include ../lib/preamble.js

await usePage(PAGE.phone);

const screen = figma.currentPage.findOne((n) => n.name === 'טלפון · מחברת המתכונים');
if (!screen) throw new Error('the notebook screen is not on this page');
const list = screen.findOne((n) => n.name === 'רשימת מתכונים');
if (!list) throw new Error('the card list is not in the notebook screen');

// [rightmost → leftmost] per card, matching the real notebook.
const PLAN = [
  [['מתכון בסיס', 'green'], ['בסיס', 'plain'], ['מילוי', 'plain']],
  [['נוסחה מאושרת', 'amber'], ['שמרים', 'plain'], ['עשיר', 'plain']],
  [['למינציה', 'plain'], ['בוקר', 'plain'], [null, null]],
  [['מתכון בסיס', 'green'], ['בסיס', 'plain'], [null, null]],
];
const KIND = {
  green: ['רקע/בחירה', 'פעולה/מרווה כהה', null],
  amber: ['רקע/אזהרה', 'משמעות/אזהרה', null],
  plain: ['רקע/משטח', 'טקסט/משני', 'קו/עדין'],
};

const mutated = [];
const cards = list.children;
for (let ci = 0; ci < cards.length; ci += 1) {
  const tagRow = cards[ci].findOne((n) => n.name === 'תגים');
  if (!tagRow) continue;
  const chips = tagRow.children.slice().reverse(); // index 0 = rightmost
  const plan = PLAN[ci] || [];
  for (let i = 0; i < plan.length; i += 1) {
    const chip = chips[i];
    if (!chip) continue;
    const [label, kind] = plan[i];
    if (!label) {
      chip.visible = false;
      mutated.push(chip.id);
      continue;
    }
    const [bg, ink, stroke] = KIND[kind];
    chip.visible = true;
    chip.fills = [pf(bg)];
    chip.strokes = stroke ? [pf(stroke)] : [];
    chip.strokeWeight = stroke ? 1 : 0;
    const t = chip.findOne((n) => n.type === 'TEXT');
    if (t) {
      await setText(t, label);
      t.fills = [pf(ink)];
    }
    mutated.push(chip.id);
  }
}

return { mutatedNodeIds: mutated, cards: cards.length };
