import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { TabBar, tabOf } from './TabBar.js';

describe('§2 tabOf — a deep screen highlights the tab that owns it', () => {
  it('maps the notebook family', () => {
    expect(tabOf('/notebook')).toBe('/notebook');
    expect(tabOf('/recipe/brioche')).toBe('/notebook');
  });

  it('maps the groups family', () => {
    expect(tabOf('/groups')).toBe('/groups');
    expect(tabOf('/group/g1')).toBe('/groups');
    expect(tabOf('/perms')).toBe('/groups');
  });

  it('maps the "more" family, including plan and stock', () => {
    for (const p of ['/more', '/settings', '/tools', '/plan', '/stock']) {
      expect(tabOf(p)).toBe('/more');
    }
  });

  it('maps BOTH production-planning routes, the list and one plan', () => {
    // The stage-10 audit found `/plans` falling through to the notebook: the
    // matcher takes an exact path or a `${p}/` prefix, so `/plan/:id` matched
    // `/plan` and the list did not. A user in their plans was told they were
    // in the notebook.
    expect(tabOf('/plans')).toBe('/more');
    expect(tabOf('/plan/abc-123')).toBe('/more');
    expect(tabOf('/ingredients')).toBe('/more');
  });

  it('falls back to the notebook for anything unknown', () => {
    expect(tabOf('/nope')).toBe('/notebook');
  });
});

describe('the tab bar tells the truth about what is built', () => {
  /*
    THE LABELS ARE BACK ON SCREEN.

    Ahmed asked for the glyph and the word together, so the name is visible
    text inside each link — which makes it the accessible name too. These
    assertions hold both halves: the word is on screen, in §2's order, and the
    link is addressable by it.
  */
  it('renders all four §2 tabs, named, in order, to the same addresses', () => {
    render(
      <MemoryRouter initialEntries={['/notebook']}>
        <TabBar />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    // The name comes from the visible text now, not from an `aria-label`.
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'בית',
      'מחברת',
      'קבוצות',
      'עוד',
    ]);
    for (const a of links) expect(a).not.toHaveAttribute('aria-label');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/home',
      '/notebook',
      '/groups',
      '/more',
    ]);
  });

  it('gives every tab a glyph, and hides it from the accessible name', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/notebook']}>
        <TabBar />
      </MemoryRouter>,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(4);
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      // One set, one grid: a glyph drawn to a different box would not sit on
      // the same optical line as the other three.
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    }
  });

  it('marks the current tab with aria-current and a heavier glyph, not only a colour', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/notebook']}>
        <TabBar />
      </MemoryRouter>,
    );
    const here = screen.getByRole('link', { name: 'מחברת' });
    expect(here).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'בית' })).not.toHaveAttribute('aria-current');

    const weights = [...container.querySelectorAll('svg')].map((s) =>
      Number(s.getAttribute('stroke-width')),
    );
    // Exactly one heavier line, and it belongs to the tab we are standing in.
    expect(weights.filter((w) => w > 2)).toHaveLength(1);
    expect(Number(here.querySelector('svg')!.getAttribute('stroke-width'))).toBeGreaterThan(2);
  });

  it('says the name once — on screen, and that is the name that is announced', () => {
    render(
      <MemoryRouter initialEntries={['/notebook']}>
        <TabBar />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'קבוצות' });
    // No `title` and no `aria-label`: with the word on screen, either one
    // would be a second copy of the same name — and a mismatch between what
    // is written and what is announced is the WCAG 2.5.3 bug.
    expect(link).not.toHaveAttribute('title');
    expect(link).not.toHaveAttribute('aria-label');
    // The word is visible text, not hidden from assistive tech.
    const label = [...link.querySelectorAll('span')].find((x) => x.textContent === 'קבוצות');
    expect(label).toBeTruthy();
    expect(label!.getAttribute('aria-hidden')).toBeNull();
  });

  it('marks nothing as pending, because nothing is', () => {
    render(
      <MemoryRouter initialEntries={['/notebook']}>
        <TabBar />
      </MemoryRouter>,
    );
    /*
      STAGE-12: none, where stage 11 had one. §10 is built — קבוצות now leads
      to the group list, a group, a group recipe and the permissions screen —
      so the label came off in the same commit that gave the tab somewhere to
      go.

      The assertion is kept as "exactly zero" rather than deleted: it is the
      one that catches the opposite mistake, a tab quietly marked pending
      again, or a new tab shipped with a label nobody removed.
    */
    expect(screen.queryAllByText('בהכנה')).toHaveLength(0);

    // A pending tab says so IN ITS NAME now, which is where the caption went.
    for (const label of ['בית', 'מחברת', 'קבוצות', 'עוד']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: `${label} — בהכנה` })).toBeNull();
    }
  });
});
