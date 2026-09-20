# artifact/ — AUDIT AND VISUALIZATION ONLY

Everything in this directory exists to LOOK at the product. Nothing in it is
imported by the product, shipped with it, or needed to build it.

**No file under `apps/`, `packages/` or `supabase/` was changed to make this
work.** The one thing outside this directory that changed in the same session is
`.git/config` (the remote was pointed at the renamed GitHub repository, which
was asked for separately). `git log -1 --stat` is the check.

## What is here

| | |
|---|---|
| `index.html` | the **ARTIFACT INSPECTOR** — the audit shell: route rail, width switcher, traceability, and the three reports. Published as an Artifact. |
| `app.html` + `viewer/app.tsx` | the mount point that renders the PRODUCT's own screens, unmodified, with a fixture repository. |
| `viewer/fixtures.ts` | **ARTIFACT FIXTURE — NOT PRODUCTION DATA.** Also the simulation session: one §10 world, several people in it. |
| `viewer/SimUserBar.tsx` | **ARTIFACT TEST TOOL — NOT PART OF THE PRODUCT'S UI.** «משתמש פעיל בסימולציה», above the chat. |
| `tsconfig.json` | typecheck for the viewer (`npx tsc -p artifact`). The product's own tsconfig does not include this directory. |
| `vite.config.ts` | builds `app.html` → `dist/` (the product's own build config is untouched). |
| `inventory.json` | the audit's single source of data. The reports and the page are both rendered from it. |
| `UI_INVENTORY.md` · `UI_AUDIT.md` · `SPEC_COVERAGE.md` | generated — edit the JSON, not these. |
| `scripts/check-routes.mjs` | fails if the viewer's route table drifts from `apps/web/src/App.tsx`. |
| `scripts/probe.mjs` | opens all 24 routes at 402 / 820 / 1440 in Chromium and records errors and overflow. |
| `scripts/probe-nav.mjs` | clicks the product's own navigation: tabs, cards, group tabs, deep links, four fixture actions. |
| `scripts/probe-inspector.mjs` | drives this page itself, as it is published. |
| `scripts/probe-shell.mjs` | the published page gives the app the whole screen: nothing leaks into `<body>`, no page scroll, all four tabs on screen. |
| `scripts/probe-chat.mjs` | holds a conversation: write, switch person, reply, announce, delete, edit, switch back — 36 checks. |
| `scripts/walk.mjs` | clicks every control on every screen and reports the ones that change nothing. |
| `scripts/keyboard.mjs` | Tab, the focus ring, Enter on a `<summary>`, and the editor's `aria-required` / `aria-invalid` / `aria-describedby` — 11 checks. |

## Rebuild and re-verify

```bash
node artifact/scripts/check-routes.mjs                 # the viewer still mirrors App.tsx
npx vite build --config artifact/vite.config.ts        # → artifact/dist
node artifact/scripts/report.mjs                       # reports + inject data into index.html
node artifact/scripts/probe.mjs                        # 72 route×width loads
node artifact/scripts/probe-nav.mjs                    # 30 navigation checks
node artifact/scripts/probe-inspector.mjs              # 27 checks on the page itself
node artifact/scripts/probe-shell.mjs                  # 15 checks: the app gets the whole screen
node artifact/scripts/probe-chat.mjs                   # 36 checks: a conversation between members
node artifact/scripts/walk.mjs                         # every control on every screen
node artifact/scripts/keyboard.mjs                     # 11 checks: keyboard, focus, ARIA
npx tsc -p artifact                                    # the viewer typechecks
```

`artifact/dist/` is not committed (`.gitignore` covers `dist/`).

## What the viewer is, exactly

It renders the product's screens from `apps/web/src/routes/` inside the
product's own `AuthProvider` → `AppDataProvider` → `OnboardingGate` →
`AppShell` stack. Two things differ, both forced, both in the viewer's header:

1. `MemoryRouter` instead of `BrowserRouter` — an artifact page does not own the
   address bar.
2. `AuthProvider` is handed `client={null}` (its existing test seam), so the
   session is 'unconfigured'. Nothing signs in.

The data is the five demo recipes from `apps/web/src/data/demoRecipes.ts`
(product data) plus the fixture layer: groups, chat, invitations, a plan, six
catalog materials. `capabilities()` reports a connected account — the only way
to see the screens as a signed-in user sees them — and the inspector says so on
every screen, because no request leaves the page.

**No Supabase, no auth, no Realtime, no Storage, no email.** An action that
looks like it succeeded succeeded in browser memory. Signed image URLs come
back null, which is a state the gallery already handles.

## The one control that is not the product's

Above the group chat there is a dashed grey box: **משתמש פעיל בסימולציה**. It
switches which member of that group's roster the page is acting as, through the
same seam the screen tests use (`AppDataProvider` takes `repository` and
`userId`). There is no user switcher in Recipe Notebook, the box says so, and it
grants nothing: after a switch every screen asks the fixture again, and the
fixture applies `features/groups/roles.ts` — the same ranks the RLS policies
compare. Messages, read markers, names, pictures and member roles survive a
switch; courses, lessons, items and item permissions created during the session
are rebuilt from the seed.
