/*
  The audit viewer's mount point.

  ─────────────────────────────────────────────────────────────────────────────
  WHAT IT DOES AND DOES NOT DO

  It mounts the PRODUCT's own screens, unmodified, inside the product's own
  provider stack, with the fixture repository from ./fixtures.ts. Every screen
  below is imported from `apps/web/src/routes/`; not one of them is
  reimplemented here, and no product file was touched to make this work.

  TWO DELIBERATE DIFFERENCES FROM `apps/web/src/App.tsx`, BOTH FORCED

  1. `MemoryRouter` instead of `BrowserRouter`. An artifact page does not own
     the address bar, and a `pushState` to `/groups` inside it would produce a
     URL that 404s on reload. The router is the only swapped part; every
     navigation component (`TabBar`, every `Link`, every `navigate()`) is the
     product's own and is exercised as written.

  2. `AuthProvider` is given `client={null}` — its existing test seam — so the
     session status is 'unconfigured', exactly as in a checkout with no
     `.env.local`. Nothing here signs anybody in.

  THE ROUTE TABLE IS CHECKED AGAINST THE PRODUCT'S

  A copied route table can drift from the real one, and a viewer that shows a
  route the product does not have (or misses one it does) is worse than no
  viewer. `../scripts/check-routes.mjs` parses `App.tsx` and this file and
  fails if the two lists disagree. It runs in the build.

  ONE PATH THAT DOES NOT EXIST IN THE PRODUCT, AND IT IS NAMESPACED

  `/__inspector/auth` renders `AuthScreen`, which in production is not a route
  at all: `AuthGate` shows it when the session status is 'signed-out'. It is
  namespaced under `/__inspector/` so it can never be mistaken for a product
  route, and the inspector labels it as a component preview.
*/

import { StrictMode, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

import { AuthProvider } from '../../apps/web/src/auth/AuthProvider.js';
import { AppDataProvider } from '../../apps/web/src/app/AppDataProvider.js';

import { AppRoutes } from './routes.js';
import { createViewerRepository, setSelfDisplayName } from './fixtures.js';
import { installSimSeam, useActiveSimUser } from './simUser.js';
import '../../apps/web/src/styles/tokens.css';
import '../../apps/web/src/styles/global.css';

/**
 * Tells the inspector where the product navigated, takes its requests, and
 * keeps the page's hash in step with the route.
 *
 * THE HASH IS NOT DECORATION — IT IS WHAT MAKES A RELOAD BEHAVE
 *
 * In production the router is `BrowserRouter`: a reload lands on the same URL,
 * with the same query string, so the scale a person set is still in force and
 * a deep link opens the screen it names. This page cannot own the address bar,
 * so the route is mirrored into the hash and read back at boot. Without it a
 * reload inside the artifact silently returned to whatever route the page was
 * opened at, which is a behaviour the product does not have — and the audit
 * asked for reload and deep links to be tested, which they cannot be against a
 * page that forgets where it is.
 *
 * `replaceState` rather than assigning `location.hash`, because assigning adds
 * a history entry and would make the browser's Back button walk the same route
 * twice.
 */
function InspectorBridge() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    window.parent?.postMessage(
      { source: 'recipe-notebook-viewer', type: 'route', path: location.pathname },
      '*',
    );
  }, [location.pathname]);

  /*
    PUSH, so the browser's own Back and Forward work.

    `MemoryRouter` keeps its history in memory and never touches the browser's,
    so before this the page had exactly one browser entry and Back left the app
    entirely — measured: the hash came back empty. Mirroring each location into
    a pushed entry gives Back and Forward something to walk, and `popstate`
    (below) applies whatever entry the browser lands on back into the router.
    The hash is the single source of truth for which screen is on the page, in
    both directions.

    The first sync REPLACES rather than pushes: a page opened with no hash
    would otherwise get a spare entry, and Back would appear to do nothing.
  */
  const first = useRef(true);

  /*
    NO "am I inside a popstate" FLAG, and that is the fix rather than the
    omission: the first version kept one, and when a pop landed the router
    exactly where it already was, the effect never ran to clear it — so the
    NEXT real navigation was swallowed and Back walked to the wrong screen.
    The comparison below is enough on its own. After a pop the hash and the
    router agree, so it returns without pushing; if the router redirects
    somewhere else (an unknown route goes to the notebook), pushing the place
    it actually landed is what should happen anyway.
  */
  useEffect(() => {
    const here = `${location.pathname}${location.search}`;
    if (window.location.hash.replace(/^#/, '') === here) {
      first.current = false;
      return;
    }
    try {
      if (first.current) window.history.replaceState(null, '', `#${here}`);
      else window.history.pushState(null, '', `#${here}`);
    } catch {
      /* a sandboxed frame may refuse; the page still works, it just forgets
         where it was on reload. */
    }
    first.current = false;
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onPop = (): void => {
      const there = window.location.hash.replace(/^#/, '') || '/notebook';
      // `replace`: the browser already moved, so this puts the router where
      // the browser is rather than adding a step of its own.
      navigate(there, { replace: true });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [navigate]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { target?: string; type?: string; path?: string } | null;
      if (!data || data.target !== 'recipe-notebook-viewer') return;
      if (data.type === 'goto' && typeof data.path === 'string') navigate(data.path);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  return null;
}

const initialPath = window.location.hash.replace(/^#/, '') || '/notebook';

/* The audit viewer is the owner's own page, and the rosters say so. The name
   lives here rather than in the fixture, so the shareable demo — which builds
   from the same fixture and never runs this line — does not carry it. */
setSelfDisplayName('אחמד נסאסרה');

/*
  ONE MORE VIEWER-ONLY SEAM, AND IT IS THE SAME ONE THE TESTS USE

  `AppDataProvider` already takes `repository` and `userId` — the injection
  point screen tests are written against. The viewer builds a repository for
  whoever the seam says is acting (see ./simUser.ts), so switching person
  changes both props and nothing else: every screen below re-reads, exactly as
  it would after a sign-in, because that is all that changed as far as the
  product can tell. The router is NOT remounted, so the switch happens where
  you are standing and leaves you in the conversation.

  There is no CONTROL for it any more. The dashed grey bar that used to sit
  above the chat was removed at Ahmed's request; the switch itself stayed,
  because the chat's 55 permission checks are held by being able to answer as
  somebody else. It is a `window` seam now — invisible, console-only, and
  documented in simUser.ts.
*/
function Viewer() {
  const activeUserId = useActiveSimUser();
  const repository = useMemo(() => createViewerRepository(activeUserId), [activeUserId]);

  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider client={null}>
        <AppDataProvider repository={repository} userId={activeUserId}>
          <InspectorBridge />
          <AppRoutes authPreview />
        </AppDataProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

/* Viewer plumbing, installed once before the first render. */
installSimSeam();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Viewer />
  </StrictMode>,
);
