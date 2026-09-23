/*
  THE SHAREABLE DEMO'S MOUNT POINT.

  One HTML file that someone can download, open and pass on. It renders the
  PRODUCT's own screens — the same route table the audit viewer uses
  (./routes.tsx), the same providers, not one screen reimplemented — on top of
  the fixture data, with two things added that the audit viewer does not need:

    1. `createDemoRepository` (./demoRepository.ts), so what a person creates
       here is still there when they come back.
    2. `DemoNotice` (./DemoNotice.tsx), which says what this is: sample data,
       local saving, no account, no sync.

  THE ROUTER IS `MemoryRouter`, MIRRORED INTO THE HASH.

  A file opened from disk has no server to answer `/notebook`, so a
  `BrowserRouter` would produce URLs that cannot be reloaded. The route is
  mirrored into the hash instead — which is also what makes reload, Back,
  Forward and a shared deep link behave the way they do in the product.

  NOTHING HERE REACHES A SERVER. `AuthProvider` is given `client={null}` (its
  existing test seam), the repository is the fixture, and the build carries no
  Supabase URL or key — `../vite.demo.config.ts` defines both as empty and
  `../scripts/standalone.mjs` fails the build if either appears in the output.
*/

import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

import { AuthProvider } from '../../apps/web/src/auth/AuthProvider.js';
import { AppDataProvider } from '../../apps/web/src/app/AppDataProvider.js';
import type { Repository } from '../../apps/web/src/data/repository.js';
import { AppRoutes } from './routes.js';
import { VIEWER_USER_ID } from './fixtures.js';
import { createDemoRepository } from './demoRepository.js';
import { DemoNotice } from './DemoNotice.js';
import { probeStorage, type StorageState } from './demoStore.js';
import '../../apps/web/src/styles/tokens.css';
import '../../apps/web/src/styles/global.css';

/** Keeps the hash and the router in step, in both directions. */
function HashSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const first = useRef(true);

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
      /* a sandboxed frame may refuse; the demo still works, it just forgets
         where it was on reload. */
    }
    first.current = false;
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onPop = (): void => {
      navigate(window.location.hash.replace(/^#/, '') || '/notebook', { replace: true });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [navigate]);

  return null;
}

function Demo({ repository, storage }: { repository: Repository; storage: StorageState }) {
  /* Read once, at boot: the hash is where a shared link points. */
  const [initialPath] = useState(() => window.location.hash.replace(/^#/, '') || '/notebook');

  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider client={null}>
        <AppDataProvider repository={repository} userId={VIEWER_USER_ID}>
          <HashSync />
          <DemoNotice storage={storage} />
          <AppRoutes />
        </AppDataProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

/*
  The saved demo is replayed BEFORE the first render, so the notebook never
  shows the sample five and then flickers to what the person actually has.
*/
const storage = probeStorage();

/* `.then` rather than a top-level `await`: the build targets browsers that do
   not all support one, and this demo is meant to open wherever it lands. */
void createDemoRepository(VIEWER_USER_ID).then(({ repository }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Demo repository={repository} storage={storage} />
    </StrictMode>,
  );
});
