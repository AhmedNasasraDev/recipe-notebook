/*
  16 · THE CLICKABLE FLOW  (phone page)

  Wires the one path that matters end to end:
    notebook → recipe → change the batch → weigh → cook → back to the recipe.

  Figma prototypes cannot jump between pages, so every frame in the flow lives
  on the phone page. Reactions are attached to the real controls (the card, the
  "מצב הכנה" button, the gate, "הבא", "סיום ההכנה"), not to invisible hotspots,
  so the prototype breaks loudly if a control is renamed — which is the point.

  Run this AFTER scripts 02–05, or the destinations will not exist yet.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);

const byName = (name) => {
  const n = page.findOne((x) => x.name === name);
  if (!n) throw new Error(`frame not found: "${name}" — run the screen scripts first`);
  return n;
};
const notebook = byName('טלפון · מחברת המתכונים');
const recipe = byName('טלפון · מתכון');
const scaleSheet = byName('טלפון · שינוי כמות');
const mise = byName('טלפון · מיז אן פלאס');
const cook = byName('טלפון · מצב הכנה · שלב');

const SMOOTH = { type: 'SMART_ANIMATE', easing: { type: 'EASE_OUT' }, duration: 0.3 };
const navigate = (destinationId, transition) => ({
  trigger: { type: 'ON_CLICK' },
  actions: [
    {
      type: 'NODE',
      destinationId,
      navigation: 'NAVIGATE',
      transition: transition || null,
      preserveScrollPosition: false,
      resetVideoPosition: false,
      resetScrollPosition: false,
      resetInteractiveComponents: false,
    },
  ],
});
const back = () => ({ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'BACK' }] });

const wired = [];
const wire = async (node, reaction, label) => {
  await node.setReactionsAsync([reaction]);
  wired.push(`${label} → ${node.name}`);
};

// 1 · a card in the notebook opens the recipe
const firstCard = notebook.findOne((n) => n.name === 'רשימת מתכונים').children[1];
await wire(firstCard, navigate(recipe.id), 'מחברת · בריוש נאנטר');

// 2 · the recipe's own two paths
const cookBtn = recipe.findOne((n) => n.name === 'כפתור · מצב הכנה');
await wire(cookBtn, navigate(mise.id), 'מתכון · מצב הכנה');
const scaleCard = recipe.findOne((n) => n.name === 'כמה להכין?');
await wire(scaleCard, navigate(scaleSheet.id, { type: 'SLIDE_IN', direction: 'TOP', easing: { type: 'EASE_OUT' }, duration: 0.25 }), 'מתכון · כמה להכין');

// 3 · the sheet applies or cancels
const apply = scaleSheet.findOne((n) => n.name === 'עדכון הכמויות');
if (apply) await wire(apply, navigate(recipe.id, SMOOTH), 'גלילון · עדכון');
const cancel = scaleSheet.findOne((n) => n.name === 'ביטול');
if (cancel) await wire(cancel, back(), 'גלילון · ביטול');

// 4 · the gate opens the steps
const gate = mise.findOne((n) => n.name === 'שער · מתחילים בהכנה');
await wire(gate, navigate(cook.id), 'מיז אן פלאס · השער');

// 5 · stepping forward, and the way out
const next = cook.findOne((n) => n.name === 'ניווט · הבא');
await wire(next, navigate(cook.id, SMOOTH), 'הכנה · הבא (אותו מסך, למצב הבא)');
const prev = cook.findOne((n) => n.name === 'ניווט · הקודם');
if (prev) await wire(prev, back(), 'הכנה · הקודם');

// 6 · the flow's starting point
page.flowStartingPoints = [{ nodeId: notebook.id, name: 'מסלול ההכנה' }];

return {
  mutatedNodeIds: [firstCard.id, cookBtn.id, scaleCard.id, gate.id, next.id],
  wired,
  startingPoint: notebook.name,
};
