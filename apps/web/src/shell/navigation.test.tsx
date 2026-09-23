import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { BackControl } from '../components/BackLink.js';
import { parentName, parentOf } from './navigation.js';

/*
  ── THE RULES AHMED GAVE FOR "BACK", ONE CASE EACH ──────────────────────────

    · "כשיש מסך קודם בתוך האפליקציה, חזור אליו"
    · "כשאין היסטוריית ניווט פנימית, חזור למסך האב המתאים"
    · "לחיצה על חזרה פנימית לא תוציא את המשתמש מהאפליקציה"
    · "במסך הבית אין צורך בכפתור חזרה"

  The third is the one worth testing hardest, because the naive implementation
  — always `navigate(-1)` — satisfies the first two and fails it silently: a
  person who opened a shared recipe link presses back and leaves for whatever
  page was there before, which looks like the application crashing.
*/

/** A page that shows where it is, so a back step is observable. */
function Where() {
  const { pathname } = useLocation();
  return (
    <div>
      <p>at {pathname}</p>
      <BackControl />
    </div>
  );
}

function app(entries: string[], index?: number) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index ?? entries.length - 1}>
      <Routes>
        <Route path="/home" element={<Where />} />
        <Route path="/notebook" element={<Where />} />
        <Route path="/more" element={<Where />} />
        <Route path="/groups" element={<Where />} />
        <Route path="/ingredients" element={<Where />} />
        <Route path="/plans" element={<Where />} />
        <Route path="/plan/:id" element={<Where />} />
        <Route path="/recipe/:id" element={<Where />} />
        <Route path="/recipe/:id/edit" element={<Where />} />
        <Route path="/group/:id" element={<Where />} />
        <Route path="/group/:id/perms" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const at = () => screen.getByText(/^at /).textContent;

describe('parentOf — where back goes when there is no history', () => {
  it('gives the four tabs no parent at all', () => {
    for (const root of ['/home', '/notebook', '/groups', '/more']) {
      expect(parentOf(root)).toBeNull();
    }
  });

  it("sends a recipe's own screens back to the recipe, not to the notebook", () => {
    for (const leaf of ['edit', 'cook', 'label', 'order']) {
      expect(parentOf(`/recipe/brioche/${leaf}`)).toBe('/recipe/brioche');
    }
  });

  it('sends a recipe, a new one and a paste to the notebook', () => {
    expect(parentOf('/recipe/brioche')).toBe('/notebook');
    expect(parentOf('/recipe/new')).toBe('/notebook');
    expect(parentOf('/paste')).toBe('/notebook');
  });

  it('nests the group screens', () => {
    expect(parentOf('/group/g1')).toBe('/groups');
    expect(parentOf('/group/g1/perms')).toBe('/group/g1');
    expect(parentOf('/group/g1/item/i2')).toBe('/group/g1');
  });

  it('sends everything under "עוד" back to it, and one plan to the list', () => {
    for (const p of ['/ingredients', '/plans', '/tools', '/settings']) {
      expect(parentOf(p)).toBe('/more');
    }
    expect(parentOf('/plan/p1')).toBe('/plans');
  });

  it('sends an invitation to Home, because nothing of ours is behind it', () => {
    expect(parentOf('/join/token-123')).toBe('/home');
  });

  it('names the destination in Hebrew', () => {
    expect(parentName('/ingredients')).toBe('עוד');
    expect(parentName('/recipe/brioche')).toBe('המחברת');
    expect(parentName('/recipe/brioche/edit')).toBe('המתכון');
    expect(parentName('/group/g1/perms')).toBe('הקבוצה');
  });

  it('is not confused by a trailing slash', () => {
    expect(parentOf('/ingredients/')).toBe('/more');
    expect(parentOf('/home/')).toBeNull();
  });
});

describe('the back control', () => {
  it('renders nothing on a root screen', () => {
    app(['/home']);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('steps back through in-app history when there is some', async () => {
    const user = userEvent.setup();
    /* Home → a recipe. Back belongs on Home, not in the notebook. */
    app(['/home', '/recipe/brioche'], 1);
    expect(at()).toBe('at /recipe/brioche');
    await user.click(screen.getByRole('button'));
    expect(at()).toBe('at /home');
  });

  it('goes to the parent when the screen is the first thing opened', async () => {
    const user = userEvent.setup();
    /* A shared link, opened cold: there is nothing behind it. */
    app(['/ingredients']);
    await user.click(screen.getByRole('button', { name: 'עוד' }));
    expect(at()).toBe('at /more');
  });

  it('cannot leave the application from a cold deep link', async () => {
    /*
      THE ONE THAT MATTERS. With a single entry in history, a `-1` would step
      out of the app. The control must not do that, so what is asserted is
      that the person is still on one of OUR screens afterwards — and that
      pressing back again still leaves them inside.
    */
    const user = userEvent.setup();
    app(['/recipe/brioche']);
    await user.click(screen.getByRole('button', { name: 'המחברת' }));
    expect(at()).toBe('at /notebook');
    /* The notebook is a root, so there is nothing further back — and no
       control offering it. */
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks the guard first, and stays put when it says no', async () => {
    const user = userEvent.setup();
    const guard = vi.fn(() => false);
    render(
      <MemoryRouter initialEntries={['/home', '/recipe/brioche/edit']} initialIndex={1}>
        <Routes>
          <Route path="/home" element={<p>at /home</p>} />
          <Route
            path="/recipe/:id/edit"
            element={
              <div>
                <p>at /recipe/brioche/edit</p>
                <BackControl guard={guard}>ביטול</BackControl>
              </div>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(guard).toHaveBeenCalled();
    expect(screen.getByText('at /recipe/brioche/edit')).toBeInTheDocument();
  });

  it('is a button, because "the screen I was on" has no address', () => {
    app(['/ingredients']);
    const back = screen.getByRole('button', { name: 'עוד' });
    expect(back.tagName).toBe('BUTTON');
    /* The glyph is decoration; the words are the accessible name. */
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
