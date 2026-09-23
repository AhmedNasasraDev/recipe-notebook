# @recipe-notebook/web

The real application. React + TypeScript + Vite, Hebrew RTL, mobile-first.

```bash
npm run dev         # from the repo root: npm run dev
npm test            # 67 tests
npm run typecheck
npm run build
```

## What is built

| screen | route | state |
|---|---|---|
| Onboarding (§4) | `/onboarding` | ✅ three steps, profile / units / tools |
| Notebook (§2.3) | `/notebook` | ✅ search, category filter, real engine figures |
| Recipe (§2.4) | `/recipe/:id` | ✅ scaling, unit views, conversion sheet, production panel |
| בית · קבוצות · עוד | `/home` `/groups` `/more` | explicit placeholders |

The three unbuilt tabs are labelled **בהכנה** rather than linked to nothing. A
tab that silently does nothing is the shape of dishonesty AC #17 rules out.

## Architecture

```
src/
  styles/tokens.css       §16 design tokens as CSS custom properties.
                          A test asserts every colour against the spec table.
  styles/global.css       RTL root, tabular-nums, .ltr and .nowrap utilities
  app/AppDataProvider     the one place data comes from
  app/OnboardingGate      §4: nothing behind the tab bar until prefs.done
  shell/AppShell          device frame, honesty banner, scroll region
  shell/TabBar            §2 four tabs + tabOf()
  data/repository.ts      ★ the seam. Screens talk to interfaces, never to
                            Supabase or IndexedDB.
  data/localDemoRepository the implementation in force until Supabase exists
  data/offlineMirror      IndexedDB cache — prefs, active recipe, cook progress
  data/demoRecipes.ts     generated from the prototype's data.js
  lib/supabase.ts         prepared client; returns null while unconfigured
  lib/database.types.ts   hand-written to match supabase/migrations
  components/SourceBadge  provenance, coloured by the engine's Source
  routes/                 the screens
  features/recipe/        ConvertSheet (§5.3) and the recipe stylesheet
```

### Styling

CSS custom properties for the §16 tokens, CSS Modules per component. No raw hex
outside `tokens.css`. RTL uses logical properties (`padding-inline`,
`border-start-start-radius`), so the Arabic locale in §15 needs a translation
layer and no layout work.

### Offline model

Supabase is the source of truth. The offline mirror holds only what has to
survive a dead zone in a kitchen: measurement preferences, the active recipe and
Cook Mode progress. It is a cache, never authoritative, and every accessor
tolerates IndexedDB being unavailable.

Writes require a connection. `WriteNotAllowedError` surfaces as a plain
explanation — never swallowed, never faked.

### The engine

`@recipe-notebook/engine` is consumed from source through a Vite alias, so a
change in the engine is picked up with no rebuild. No screen does arithmetic:
grams, yields, costs, hydration and every conversion come from `compute()`,
`convertScaled()` and `scaleFactor()`.

## What is deliberately absent

- **Export and share buttons.** The prototype's announced "X מתכונים הועתקו
  לקובץ" and "נשלח שיתוף" without doing either (B8). They return when there is
  something real behind them.
- **Cook Mode, edit, tools, settings, plan, stock, label, order** — later stages.
- **Auth.** No sign-in screen yet; the repository reports `canWrite: false` and
  the app says so.
