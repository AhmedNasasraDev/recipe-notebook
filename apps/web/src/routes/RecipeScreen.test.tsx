import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { RecipeScreen } from './RecipeScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';
import { useAppData } from '../app/AppDataProvider.js';
import { DEMO_RECIPES } from '../data/demoRecipes.js';

const prefsAt = (cupMl: number) => ({
  ...defaultPrefs('pro'),
  done: true,
  tools: { cup: cupMl, tbsp: 15, tsp: 5 },
});

/** A cup-measured recipe, so the tool setting is observable on screen. */
const CUP_CAKE: Recipe = {
  id: 'cupcake',
  name: 'עוגה במדידות ביתיות',
  category: 'עוגות ועוגיות',
  yieldUnits: 12,
  unitWeight: 60,
  targetFC: 25,
  ingredients: [
    { id: 'i1', name: 'קמח לבן', qty: 2, unit: 'כוס', flour: true, price: 5.4, priceUnit: 'ק"ג' },
    { id: 'i2', name: 'קקאו', qty: 1, unit: 'כוס' },
  ],
  steps: [{ id: 's1', text: 'מערבבים ואופים.', minutes: 40 }],
};

function renderRecipe(id: string, opts: { cupMl?: number; recipes?: Recipe[] } = {}) {
  return renderRoute(<RecipeScreen />, {
    path: '/recipe/:recipeId',
    route: `/recipe/${id}`,
    repository: fakeRepository({
      prefs: prefsAt(opts.cupMl ?? 240),
      recipes: opts.recipes ?? [...DEMO_RECIPES],
    }),
  });
}

describe('the recipe page renders the engine, not its own arithmetic', () => {
  it('shows the figures compute() produces for the brioche', async () => {
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });

    const c = compute(
      DEMO_RECIPES.find((r) => r.id === 'brioche')!,
      DEMO_RECIPES,
      { prefs: prefsAt(240) },
    );
    // 12 units at 85 g, from the engine
    expect(screen.getByText(/12 יחידות/)).toBeInTheDocument();
    expect(Math.round(c.unitsActual)).toBe(12);
  });

  it('marks an approved formula as locked (§9)', async () => {
    renderRecipe('brioche');
    expect(await screen.findByText('נוסחה מאושרת לייצור')).toBeInTheDocument();
  });

  it('says plainly that scaling does not change the recipe (§6)', async () => {
    renderRecipe('brioche');
    expect(
      await screen.findByText(/שינוי הכמויות כאן הוא חישוב בלבד/),
    ).toBeInTheDocument();
  });

  it('explains a missing recipe instead of rendering an empty page', async () => {
    renderRecipe('does-not-exist');
    expect(await screen.findByText(/לא נמצא במחברת/)).toBeInTheDocument();
  });
});

describe('B1 at the UI level — the cup setting reaches the screen', () => {
  const flourRow = () => screen.getByText('קמח לבן').closest('button')!;

  it('2 cups of flour reads 240 g with a 240 ml cup', async () => {
    renderRecipe('cupcake', { cupMl: 240, recipes: [CUP_CAKE] });
    await screen.findByRole('heading', { name: CUP_CAKE.name! });
    const row = within(flourRow());
    expect(row.getByText('2 כוס')).toBeInTheDocument();
    expect(row.getByText("240 גר'")).toBeInTheDocument();
  });

  it('and 250 g with a 250 ml cup — the prototype stayed at 240', async () => {
    renderRecipe('cupcake', { cupMl: 250, recipes: [CUP_CAKE] });
    await screen.findByRole('heading', { name: CUP_CAKE.name! });
    const row = within(flourRow());
    expect(row.getByText("250 גר'")).toBeInTheDocument();
    expect(row.queryByText("240 גר'")).not.toBeInTheDocument();
  });
});

describe('an unresolvable ingredient is shown honestly, not silently priced', () => {
  it('shows a dash and the reason for cocoa, which has no agreed value', async () => {
    renderRecipe('cupcake', { recipes: [CUP_CAKE] });
    await screen.findByRole('heading', { name: CUP_CAKE.name! });
    // cocoa is pending-verification in the merged table
    expect(screen.getByText(/נתונים סותרים/)).toBeInTheDocument();
    expect(
      screen.getByText(/לא נכנס לסך המשקל ולעלות/),
    ).toBeInTheDocument();
  });
});

describe('§5.3 conversion sheet — the B3 regression, at the UI level', () => {
  it('labels a cup ingredient converted to grams "נתון מערכת", never "המרה מדויקת"', async () => {
    const user = userEvent.setup();
    renderRecipe('cupcake', { recipes: [CUP_CAKE] });
    await screen.findByRole('heading', { name: CUP_CAKE.name! });

    // tap the flour row
    await user.click(screen.getByText('קמח לבן').closest('button')!);
    const sheet = await screen.findByRole('dialog', { name: 'המרת יחידה' });

    // §5.3: the recipe's own quantity and unit are shown, not just the grams
    expect(within(sheet).getByText('כפי שכתוב במתכון')).toBeInTheDocument();
    expect(within(sheet).getByText('2 כוס')).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'גרם' }));

    expect(within(sheet).getByLabelText('תוצאת ההמרה')).toHaveTextContent("240 גר'");
    expect(within(sheet).getByText(/נתון מערכת/)).toBeInTheDocument();
    expect(within(sheet).queryByText('המרה מדויקת')).not.toBeInTheDocument();
  });

  it('states the tool size in force, so the number is explainable', async () => {
    const user = userEvent.setup();
    renderRecipe('cupcake', { cupMl: 250, recipes: [CUP_CAKE] });
    await screen.findByRole('heading', { name: CUP_CAKE.name! });
    await user.click(screen.getByText('קמח לבן').closest('button')!);
    const sheet = await screen.findByRole('dialog', { name: 'המרת יחידה' });
    expect(within(sheet).getByLabelText('גודל כלי המדידה')).toHaveTextContent('250');
  });

  it('refuses a conversion with no reliable density, and says why', async () => {
    const user = userEvent.setup();
    renderRecipe('cupcake', { recipes: [CUP_CAKE] });
    await screen.findByRole('heading', { name: CUP_CAKE.name! });
    await user.click(screen.getByText('קקאו').closest('button')!);
    const sheet = await screen.findByRole('dialog', { name: 'המרת יחידה' });
    await user.click(within(sheet).getByRole('button', { name: 'גרם' }));
    expect(within(sheet).getByText(/נתונים סותרים/)).toBeInTheDocument();
  });

  it('offers weight targets only for a sub-recipe line (§18.6)', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche-choc');
    await screen.findByRole('heading', { name: /בריוש שוקולד/ });
    await user.click(screen.getByText(/גנאש שוקולד מריר/).closest('button')!);
    const sheet = await screen.findByRole('dialog', { name: 'המרת יחידה' });
    expect(within(sheet).getByRole('button', { name: 'כוס' })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: 'גרם' })).toBeEnabled();
  });
});

describe('§6 scaling, through the engine', () => {
  it('scaling by units recomputes the quantities on screen', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });

    await user.click(screen.getByRole('button', { name: 'יחידות' }));
    await user.type(screen.getByPlaceholderText('מספר יחידות'), '24');

    await waitFor(() => {
      expect(screen.getByText(/מקדם ×/)).toBeInTheDocument();
    });
    // 12 units at 85 g with 12% baking loss gives 11.906 actual units, so
    // targeting 24 is a factor of 2.02 — the engine's number, not a round guess
    expect(screen.getByText('2.02')).toBeInTheDocument();
  });
});

describe('§3 progressive disclosure', () => {
  it('hides cost behind the production toggle, and shows it for a pro profile', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });

    expect(screen.queryByText('עלות ותמחור')).not.toBeInTheDocument();
    await user.click(screen.getByText('פרטים מקצועיים'));
    expect(screen.getByText('תשואה ופחת')).toBeInTheDocument();
    expect(screen.getByText('עלות ותמחור')).toBeInTheDocument();
    // §13: baker's formula appears only when there is flour
    expect(screen.getByText('נוסחה')).toBeInTheDocument();
  });

  it('a home profile sees yield but not cost', async () => {
    const user = userEvent.setup();
    renderRoute(<RecipeScreen />, {
      path: '/recipe/:recipeId',
      route: '/recipe/brioche',
      repository: fakeRepository({
        prefs: { ...defaultPrefs('home'), done: true },
        recipes: [...DEMO_RECIPES],
      }),
    });
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });
    await user.click(screen.getByText('פרטים מקצועיים'));
    expect(screen.getByText('תשואה ופחת')).toBeInTheDocument();
    expect(screen.queryByText('עלות ותמחור')).not.toBeInTheDocument();
  });
});

describe('§5.4 unit display modes', () => {
  it('grams view says the recipe has not changed', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });
    const group = screen.getByRole('group', { name: 'תצוגת יחידות' });
    await user.click(within(group).getByRole('button', { name: 'גרמים' }));
    expect(screen.getByText(/המתכון המקורי לא השתנה/)).toBeInTheDocument();
  });

  it('home view warns that a row with no reliable data stays in grams', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });
    const group = screen.getByRole('group', { name: 'תצוגת יחידות' });
    await user.click(within(group).getByRole('button', { name: 'ביתי' }));
    expect(screen.getByText(/נשאר בגרמים ומסומן ככזה/)).toBeInTheDocument();
  });
});

// ── requirement 8, on screen ────────────────────────────────────────────────
// `calcState` is unit-tested in features/recipe/completeness.test.ts. What
// matters here is that a partial total never reaches the user looking whole.

/** Everything by weight: nothing needs a density, so the figures are complete. */
const ALL_WEIGHED: Recipe = {
  id: 'weighed',
  name: 'מתכון במשקל בלבד',
  category: 'לחמים ובצקים',
  yieldUnits: 10,
  unitWeight: 100,
  targetFC: 30,
  ingredients: [
    { id: 'i1', name: 'קמח לבן', qty: 600, unit: 'גרם', flour: true, price: 5.4, priceUnit: 'ק"ג' },
    // Priced at 0 on purpose: tap water really is free, and an explicit zero is
    // a price. An EMPTY price would make the cost partial, which is the
    // distinction the cost axis exists to keep.
    { id: 'i2', name: 'מים', qty: 400, unit: 'גרם', liquid: true, price: 0, priceUnit: 'ליטר' },
  ],
  steps: [{ id: 's1', text: 'ללוש ולאפות.', minutes: 40 }],
};

/** Cocoa and rice both await verification, so no row can be weighed. */
const NONE_WEIGHED: Recipe = {
  id: 'nothing',
  name: 'מתכון שאי אפשר לחשב',
  category: 'עוגות ועוגיות',
  yieldUnits: 8,
  unitWeight: 90,
  targetFC: 28,
  ingredients: [
    { id: 'i1', name: 'קקאו', qty: 1, unit: 'כוס', price: 40, priceUnit: 'ק"ג' },
    { id: 'i2', name: 'אורז', qty: 2, unit: 'כוס', price: 8, priceUnit: 'ק"ג' },
  ],
  steps: [{ id: 's1', text: 'לערבב.', minutes: 10 }],
};

describe('requirement 8 — a partial calculation is never shown as a whole one', () => {
  it('says nothing when every ingredient was weighed', async () => {
    renderRecipe('weighed', { recipes: [ALL_WEIGHED] });
    await screen.findByRole('heading', { name: ALL_WEIGHED.name! });
    expect(screen.queryByLabelText('שלמות החישוב')).not.toBeInTheDocument();
  });

  it('shows no "חלקי" marker on a complete cost figure', async () => {
    const user = userEvent.setup();
    renderRecipe('weighed', { recipes: [ALL_WEIGHED] });
    await screen.findByRole('heading', { name: ALL_WEIGHED.name! });
    await user.click(screen.getByText('פרטים מקצועיים'));
    expect(screen.queryByText('חלקי')).not.toBeInTheDocument();
  });

  it('announces the partial state with the count, at the top of the page', async () => {
    renderRecipe('cupcake', { recipes: [CUP_CAKE] });
    await screen.findByRole('heading', { name: CUP_CAKE.name! });
    const notice = screen.getByLabelText('שלמות החישוב');
    expect(notice).toHaveTextContent('נתונים חלקיים');
    expect(notice).toHaveTextContent('רכיב אחד');
    expect(notice).toHaveTextContent('קקאו');
  });

  it('marks the total cost and the sale price as partial, not as final', async () => {
    const user = userEvent.setup();
    renderRecipe('cupcake', { recipes: [CUP_CAKE] });
    await screen.findByRole('heading', { name: CUP_CAKE.name! });
    await user.click(screen.getByText('פרטים מקצועיים'));

    const costRow = screen.getByText('עלות חומרי גלם').closest('div')!;
    expect(within(costRow).getByText('חלקי')).toBeInTheDocument();
    const yieldRow = screen.getByText('תשואה תאורטית').closest('div')!;
    expect(within(yieldRow).getByText('חלקי')).toBeInTheDocument();
  });

  it('leaves the food-cost target unmarked, because it is an input and not a sum', async () => {
    const user = userEvent.setup();
    renderRecipe('cupcake', { recipes: [CUP_CAKE] });
    await screen.findByRole('heading', { name: CUP_CAKE.name! });
    await user.click(screen.getByText('פרטים מקצועיים'));
    const fcRow = screen.getByText('יעד פוד קוסט').closest('div')!;
    expect(within(fcRow).queryByText('חלקי')).not.toBeInTheDocument();
  });

  it('distinguishes "not computable" from "partial" in so many words', async () => {
    renderRecipe('nothing', { recipes: [NONE_WEIGHED] });
    await screen.findByRole('heading', { name: NONE_WEIGHED.name! });
    const notice = screen.getByLabelText('שלמות החישוב');
    expect(notice).toHaveTextContent('לא ניתן לחשב');
    expect(notice).not.toHaveTextContent('נתונים חלקיים');
  });

  it('shows a dash instead of a zero total when nothing could be weighed', async () => {
    const user = userEvent.setup();
    renderRecipe('nothing', { recipes: [NONE_WEIGHED] });
    await screen.findByRole('heading', { name: NONE_WEIGHED.name! });
    await user.click(screen.getByText('פרטים מקצועיים'));

    // A cost of ₪0.00 would read as "this recipe is free", which is the exact
    // failure mode requirement 8 exists to prevent.
    const costRow = screen.getByText('עלות חומרי גלם').closest('div')!;
    expect(within(costRow).getByText('—')).toBeInTheDocument();
    expect(within(costRow).queryByText(/₪/)).not.toBeInTheDocument();

    const yieldRow = screen.getByText('תשואה תאורטית').closest('div')!;
    expect(within(yieldRow).getByText('—')).toBeInTheDocument();
  });

  it('names every missing ingredient, so the gap can be closed', async () => {
    renderRecipe('nothing', { recipes: [NONE_WEIGHED] });
    await screen.findByRole('heading', { name: NONE_WEIGHED.name! });
    const notice = screen.getByLabelText('שלמות החישוב');
    expect(notice).toHaveTextContent('קקאו');
    expect(notice).toHaveTextContent('אורז');
  });
});


// ── the cost axis ───────────────────────────────────────────────────────────
// Found while reading a tablet screenshot of the editor: a fully weighed recipe
// with no prices showed "עלות כוללת ₪0". Every weight was real, so the mass
// axis was legitimately complete — but ₪0 reads as "this recipe is free".

/** Fully weighable, and nobody has priced anything. */
const UNPRICED: Recipe = {
  id: 'unpriced',
  name: 'מתכון בלי מחירים',
  category: 'לחמים ובצקים',
  yieldUnits: 10,
  unitWeight: 100,
  targetFC: 30,
  ingredients: [
    { id: 'i1', name: 'קמח לבן', qty: 600, unit: 'גרם', flour: true },
    { id: 'i2', name: 'מים', qty: 400, unit: 'גרם', liquid: true },
  ],
  steps: [],
};

/** Fully weighable, half priced. */
const HALF_PRICED: Recipe = {
  ...UNPRICED,
  id: 'halfpriced',
  name: 'מתכון עם חצי מחירים',
  ingredients: [
    { id: 'i1', name: 'קמח לבן', qty: 600, unit: 'גרם', flour: true, price: 5.4, priceUnit: 'ק"ג' },
    { id: 'i2', name: 'חמאה 82%', qty: 200, unit: 'גרם' },
  ],
};

describe('a fully weighed recipe with no prices has no cost, not a cost of zero', () => {
  it('shows a dash instead of ₪0.00', async () => {
    const user = userEvent.setup();
    renderRecipe('unpriced', { recipes: [UNPRICED] });
    await screen.findByRole('heading', { name: UNPRICED.name! });
    await user.click(screen.getByText('פרטים מקצועיים'));

    const costRow = screen.getByText('עלות חומרי גלם').closest('div')!;
    expect(within(costRow).getByText('—')).toBeInTheDocument();
    expect(within(costRow).queryByText(/₪/)).not.toBeInTheDocument();
  });

  it('says outright that no prices were entered', async () => {
    const user = userEvent.setup();
    renderRecipe('unpriced', { recipes: [UNPRICED] });
    await screen.findByRole('heading', { name: UNPRICED.name! });
    await user.click(screen.getByText('פרטים מקצועיים'));

    const notice = screen.getByLabelText('שלמות התמחור');
    expect(notice).toHaveTextContent('לא הוזנו מחירים לאף רכיב');
    expect(notice).toHaveTextContent('אפס אינו התשובה');
  });

  it('still shows the weight figures, which are complete', async () => {
    const user = userEvent.setup();
    renderRecipe('unpriced', { recipes: [UNPRICED] });
    await screen.findByRole('heading', { name: UNPRICED.name! });
    // The mass axis is independent: it must NOT be dragged down with the cost.
    expect(screen.queryByLabelText('שלמות החישוב')).not.toBeInTheDocument();
    await user.click(screen.getByText('פרטים מקצועיים'));
    const yieldRow = screen.getByText('תשואה תאורטית').closest('div')!;
    expect(within(yieldRow).getByText('1 ק"ג')).toBeInTheDocument();
  });
});

describe('a partly priced recipe says so and marks the cost', () => {
  it('names the ingredient that has no price', async () => {
    const user = userEvent.setup();
    renderRecipe('halfpriced', { recipes: [HALF_PRICED] });
    await screen.findByRole('heading', { name: HALF_PRICED.name! });
    await user.click(screen.getByText('פרטים מקצועיים'));

    const notice = screen.getByLabelText('שלמות התמחור');
    expect(notice).toHaveTextContent('רכיב אחד');
    expect(notice).toHaveTextContent('חמאה 82%');
    expect(notice).toHaveTextContent('נמוכה מהעלות בפועל');
  });

  it('shows the figure, marked partial — it is real, just incomplete', async () => {
    const user = userEvent.setup();
    renderRecipe('halfpriced', { recipes: [HALF_PRICED] });
    await screen.findByRole('heading', { name: HALF_PRICED.name! });
    await user.click(screen.getByText('פרטים מקצועיים'));

    const costRow = screen.getByText('עלות חומרי גלם').closest('div')!;
    expect(within(costRow).getByText(/₪/)).toBeInTheDocument();
    expect(within(costRow).getByText('חלקי')).toBeInTheDocument();
  });
});

describe('an explicit price of zero is a price', () => {
  it('does not make the cost partial — tap water really is free', async () => {
    const user = userEvent.setup();
    renderRecipe('weighed', { recipes: [ALL_WEIGHED] });
    await screen.findByRole('heading', { name: ALL_WEIGHED.name! });
    await user.click(screen.getByText('פרטים מקצועיים'));
    expect(screen.queryByLabelText('שלמות התמחור')).not.toBeInTheDocument();
    expect(screen.queryByText('חלקי')).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage-10 audit, §10 — two controls, one name.
//
// Found by running Chromium's accessibility tree over the built page at three
// viewports: both button groups had a "כמו במתכון", one under "מצב שינוי
// כמויות" and one under "תצוגת יחידות". A screen reader that announces the
// group can tell them apart; a voice-control user saying the words cannot, and
// nor can a list of the page's controls. This guard is the same question asked
// of the rendered DOM, so it cannot come back.
describe('stage-10 audit, §10: every control on the page has its own name', () => {
  it('no button is addressable by the bare name that used to be ambiguous', async () => {
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });

    // `name` here is Testing Library's accessible-name query — the same
    // algorithm `getByRole` uses everywhere else, so a name it matches is a
    // name a user can address. Nothing answers to the bare words any more,
    // which is precisely what stops the two buttons colliding.
    expect(screen.queryAllByRole('button', { name: 'כמו במתכון' })).toHaveLength(0);
  });

  it('each of the two carries the name of what it changes', async () => {
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });

    const scale = screen.getByRole('button', { name: 'כמויות כמו במתכון' });
    const view = screen.getByRole('button', { name: 'תצוגה כמו במתכון' });
    // WCAG 2.5.3 (Label in Name): the accessible name contains the visible
    // text, so speaking what is written still hits the control.
    expect(scale).toHaveTextContent('כמו במתכון');
    expect(view).toHaveTextContent('כמו במתכון');
    expect(scale).not.toBe(view);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage-11 — the two loss rows, and the project's own null-vs-zero rule.
//
// "פחת אפייה 0.0%" told every baker in the notebook that their bread lost no
// water, when the truth was that nobody had weighed it. The rule the whole
// data model turns on was being broken by two `toFixed(1)` calls.
describe('stage-11: פחת is a measurement, and says so when it is missing', () => {
  const unweighed: Recipe = {
    id: 'loss',
    name: 'לחם כפרי',
    category: 'לחמים',
    unitWeight: 500,
    yieldUnits: 2,
    ingredients: [
      { id: 'i1', name: 'קמח לחם', qty: 1000, unit: 'g', flour: true },
      { id: 'i2', name: 'מים', qty: 700, unit: 'g', liquid: true },
    ],
    steps: [],
  } as unknown as Recipe;

  const open = async (recipe: Recipe) => {
    const user = userEvent.setup();
    renderRecipe(recipe.id, { recipes: [recipe] });
    await screen.findByRole('heading', { name: recipe.name as string });
    await user.click(screen.getByText('פרטים מקצועיים'));
  };

  it('says the batch was not weighed instead of printing a loss of zero', async () => {
    await open(unweighed);
    expect(screen.getByText(/לא נשקל לפני ואחרי/)).toBeInTheDocument();
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  });

  it('says the yield was not measured instead of a production loss of zero', async () => {
    await open(unweighed);
    expect(screen.getByText(/לא נמדדה תשואה בפועל/)).toBeInTheDocument();
  });

  it('shows the real figure once both weights are there', async () => {
    await open({ ...unweighed, weightBefore: 1000, weightAfter: 880 } as unknown as Recipe);
    expect(screen.getByText('12.0%')).toBeInTheDocument();
    expect(screen.queryByText(/לא נשקל/)).not.toBeInTheDocument();
  });

  it('shows a measured production loss when the actual yield was entered', async () => {
    // 1700 g theoretical, 1600 g on the scale → 5.9%.
    await open({ ...unweighed, yieldActual: 1600 } as unknown as Recipe);
    expect(screen.getByText('5.9%')).toBeInTheDocument();
  });

  it('treats a measured 0 as a measurement, not as a blank', async () => {
    await open({ ...unweighed, weightBefore: 1000, weightAfter: 0 } as unknown as Recipe);
    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.queryByText(/לא נשקל/)).not.toBeInTheDocument();
  });

  it('withholds the loss when only one of the two weights was entered', async () => {
    await open({ ...unweighed, weightBefore: 1000 } as unknown as Recipe);
    expect(screen.getByText(/לא נשקל לפני ואחרי/)).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage-11 — a price that moves while the recipe page is open.
//
// Found by turning on react-hooks/exhaustive-deps, which is the only tool that
// could have found it: the code type-checked, every test passed, and the bug
// was a dependency list that did not match what the callback read. `baseline`
// recomputed when the catalog changed and `computed` did not, so the ingredient
// table and every cost figure kept the old price while the yield figures had
// the new one.
//
// The catalog has to change WITHOUT remounting the screen — navigating away and
// back would pass even with the bug — so the test renders a control beside the
// page that writes to the same provider, which is what the ingredient centre
// does in the real app.
describe('stage-11: the page follows a price change without being remounted', () => {
  const PRICED: Recipe = {
    id: 'bread',
    name: 'לחם שיפון',
    category: 'לחמים',
    ingredients: [
      { id: 'i1', name: 'קמח שיפון', ingredientKey: 'קמח שיפון', qty: 1000, unit: 'g', flour: true },
    ],
    steps: [],
  } as unknown as Recipe;

  const flourAt = (total: number) => ({
    id: 'cat-rye',
    key: 'קמח שיפון',
    name: 'קמח שיפון',
    purchaseUnit: 'kg' as const,
    packageQty: 1,
    packageCount: 1,
    purchaseTotal: total,
    usablePct: null,
    supplier: '',
    purchasedAt: null,
    priceUpdatedAt: null,
    note: '',
    purchasePrice: total,
    price: total,
    priceUnit: 'ק"ג' as const,
    allergens: [],
  });

  /** Stands in for the ingredient centre: changes a price in place. */
  function RaisePrice() {
    const { saveCatalogItem } = useAppData();
    return (
      <button type="button" onClick={() => void saveCatalogItem(flourAt(9))}>
        ייקור הקמח
      </button>
    );
  }

  it('recomputes the cost when the catalog moves under it', async () => {
    const user = userEvent.setup();
    renderRoute(
      <>
        <RecipeScreen />
        <RaisePrice />
      </>,
      {
        path: '/recipe/:recipeId',
        route: '/recipe/bread',
        repository: fakeRepository({
          prefs: prefsAt(240),
          recipes: [PRICED],
          catalog: [flourAt(4)],
          canWrite: true,
        }),
      },
    );

    // 1 kg of rye at ₪4/kg.
    await screen.findByRole('heading', { name: 'לחם שיפון' });
    await user.click(screen.getByText('פרטים מקצועיים'));
    // `getAllBy`: ₪4 is both the batch cost and the cost per kilo here, one
    // kilo being the whole recipe.
    expect(screen.getAllByText('₪4').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('₪9')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'ייקור הקמח' }));

    // The same kilo at ₪9. Before the fix this stayed ₪4 until the screen was
    // remounted, while the figures taken from the baseline had already moved.
    await waitFor(() => expect(screen.getAllByText('₪9').length).toBeGreaterThan(0));
    expect(screen.queryAllByText('₪4')).toHaveLength(0);
  });
});

/*
  ── §2 screens 8 and 9: getting to the two print outputs ───────────────────

  The link to the order sheet has to carry the CURRENT "כמה להכין" setting,
  because an order sheet showing the recipe quantities instead of the order's
  quantities is worse than no order sheet: it looks right at the bench.

  It travels in the query string rather than in router state so that reloading
  or re-printing the page produces the same sheet, and so the link can be sent
  to whoever is weighing. These tests are about the link, not about the sheet —
  OrderScreen.test.tsx holds the other end.
*/
/*
  UX PASS: BOTH SHEETS MOVED UNDER "עוד פעולות".

  They are occasional — a label is printed once, an order sheet when there is
  an order — and they were two of the six controls between the recipe's name
  and its ingredients. Nothing about them changed except where they are, which
  these tests now say out loud by opening the panel first. What each link
  CARRIES (the scale, or deliberately nothing) is still pinned exactly as it
  was, because that is the part that is easy to break.
*/
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('עוד פעולות'));
  return screen.getByRole('group', { name: 'פלטים להדפסה' });
}

describe('§2 the way to the label and the order sheet', () => {
  it('offers both, on any profile', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });
    const group = await openMore(user);
    expect(within(group).getByRole('link', { name: 'תווית מוצר' })).toHaveAttribute(
      'href',
      '/recipe/brioche/label',
    );
    expect(within(group).getByRole('link', { name: 'דף הזמנה' })).toBeInTheDocument();
  });

  it('links to the order sheet with no scale while nothing is scaled', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });
    const group = await openMore(user);
    // A bare URL means "as written", which is clearer than "?mode=recipe".
    expect(within(group).getByRole('link', { name: 'דף הזמנה' })).toHaveAttribute(
      'href',
      '/recipe/brioche/order',
    );
  });

  it('carries the units the user asked for into the link', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });

    await user.click(screen.getByRole('button', { name: 'יחידות' }));
    await user.type(screen.getByLabelText('מספר יחידות'), '36');

    const group = await openMore(user);
    await waitFor(() =>
      expect(within(group).getByRole('link', { name: 'דף הזמנה' })).toHaveAttribute(
        'href',
        '/recipe/brioche/order?mode=units&v=36',
      ),
    );
  });

  it('does not put a scale in the link when the value changes nothing', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });

    // An empty box in "יחידות" mode is not a scale of any kind, and a link
    // saying ?mode=units&v= would be a promise about nothing.
    await user.click(screen.getByRole('button', { name: 'יחידות' }));
    const group = await openMore(user);
    expect(within(group).getByRole('link', { name: 'דף הזמנה' })).toHaveAttribute(
      'href',
      '/recipe/brioche/order',
    );
  });

  /*
    A SCALE BELONGS TO ONE RECIPE (audit finding F25)

    This screen stays mounted when one recipe leads to another — same route
    pattern, same component — and "שכפול" is the path in the product: it saves
    a copy and navigates to it. The copy used to open with the previous
    recipe's scale still applied, on a recipe nobody had asked to scale.

    The duplicate needs a writable repository, which is also what makes this
    the real path rather than a simulated one.
  */
  it('does not carry a scale from one recipe into the next (F25)', async () => {
    const user = userEvent.setup();
    renderRoute(<RecipeScreen />, {
      path: '/recipe/:recipeId',
      route: '/recipe/brioche',
      repository: fakeRepository({
        prefs: prefsAt(240),
        recipes: [...DEMO_RECIPES],
        canWrite: true,
      }),
    });
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });

    await user.click(screen.getByRole('button', { name: 'יחידות' }));
    await user.type(screen.getByLabelText('מספר יחידות'), '24');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'מצב הכנה' })).toHaveAttribute(
        'href',
        '/recipe/brioche/cook?mode=units&v=24',
      ),
    );

    // "שכפול" now lives under "עוד פעולות" (UX pass); the defect it exercises
    // — a scale surviving into a different recipe — is unchanged.
    await user.click(screen.getByText('עוד פעולות'));
    await user.click(screen.getByRole('button', { name: /^שכפול/ }));
    await screen.findByRole('heading', { name: /עותק/ });

    // The copy is the recipe as written: no factor, and nothing in the link.
    const cook = screen.getByRole('link', { name: 'מצב הכנה' });
    expect(cook.getAttribute('href')).toMatch(/^\/recipe\/[^?]+\/cook$/);
    expect(screen.getByRole('button', { name: 'כמויות כמו במתכון' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByLabelText('מספר יחידות')).not.toBeInTheDocument();
  });

  /*
    §14 Cook Mode is the third screen that needs the scale, and the one where
    being wrong is worst: the order sheet is read at a desk, Mise en place is
    weighed. The link carries the same three parameters, built by the same
    `scaleQuery`, so what is weighed is what was asked for.
  */
  it('carries the same scale into "מצב הכנה", because that is what gets weighed', async () => {
    const user = userEvent.setup();
    renderRecipe('brioche');
    await screen.findByRole('heading', { name: 'בריוש נאנטר' });

    expect(screen.getByRole('link', { name: 'מצב הכנה' })).toHaveAttribute(
      'href',
      '/recipe/brioche/cook',
    );

    await user.click(screen.getByRole('button', { name: 'יחידות' }));
    await user.type(screen.getByLabelText('מספר יחידות'), '36');

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'מצב הכנה' })).toHaveAttribute(
        'href',
        '/recipe/brioche/cook?mode=units&v=36',
      ),
    );
  });
});

/*
  ── the design pass: the hero at the top of the recipe ─────────────────────

  The handoff puts a wide photograph at the top of the recipe, with the back
  and menu buttons on it, and is explicit that a recipe WITHOUT a photograph
  must not show a large empty rectangle in its place. These tests hold both
  halves of that, plus the RTL direction of the back control, which is the
  thing that is easiest to reintroduce by accident.
*/
describe('the recipe opens with its photograph, or with nothing at all', () => {
  const heroOf = (recipeId: string) =>
    renderRoute(<RecipeScreen />, {
      path: '/recipe/:recipeId',
      route: `/recipe/${recipeId}`,
      repository: fakeRepository({
        prefs: prefsAt(240),
        recipes: [...DEMO_RECIPES],
        images: [
          {
            id: 'i1',
            recipeId: 'brioche',
            storagePath: 'brioche/i1.webp',
            ord: 0,
            width: 1600,
            height: 1200,
            bytes: 120000,
            caption: '',
            createdAt: '2026-09-17T10:00:00Z',
          },
        ],
      }),
    });

  it('shows the first photograph above the name', async () => {
    heroOf('brioche');
    const title = await screen.findByRole('heading', { name: 'בריוש נאנטר' });
    // One photograph, drawn twice: the hero at the top and the gallery below
    // the steps. The hero has no accessible name on purpose — `alt=""` takes
    // it out of the accessibility tree, which is why it is reached through the
    // DOM here and not through a role query.
    await screen.findByRole('img', { name: 'תמונה של המתכון' });
    const shown = document.querySelectorAll('img');
    expect(shown).toHaveLength(2);
    const hero = shown[0]!;
    expect(hero).toHaveAttribute('src', 'blob:signed/brioche/i1.webp');
    expect(hero).toHaveAttribute('aria-hidden', 'true');
    // DOCUMENT_POSITION_FOLLOWING: the title comes after the picture.
    expect(hero.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no picture frame at all on a recipe that has none', async () => {
    heroOf('pastrycream');
    await screen.findByRole('heading', { name: 'קרם פטיסייר וניל' });
    // The gallery below the steps has finished loading — so this is the empty
    // state, not a picture that has not arrived yet.
    await screen.findByText(/הוספת תמונה|אין תמונות למתכון הזה/);
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('puts the way back under a name a reader can say', async () => {
    heroOf('brioche');
    const back = await screen.findByRole('link', { name: 'המחברת' });
    expect(back).toHaveAttribute('href', '/notebook');
    // The chevron is decoration; the name is the accessible name above.
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens the actions from the menu button on the hero', async () => {
    const user = userEvent.setup();
    heroOf('brioche');
    const menu = await screen.findByRole('button', { name: 'עוד פעולות על המתכון' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('button', { name: /מחיקת/ })).toBeInTheDocument();
  });
});
