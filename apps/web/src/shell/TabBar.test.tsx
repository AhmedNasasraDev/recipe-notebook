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
    THE LABELS MOVED; THEY DID NOT GO.

    The bar is glyphs now, so "is the name on screen?" is the wrong question
    and `getByText` is the wrong tool — it would also find the desktop
    tooltip, which is decoration. What has to hold is that each destination is
    still a link with its Hebrew name, in §2's order, pointing where it always
    did.
  */
  it('renders all four §2 tabs, named, in order, to the same addresses', () => {
    render(
      <MemoryRouter initialEntries={['/notebook']}>
        <TabBar />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'בית',
      'מחברת',
      'קבוצות',
      'עוד',
    ]);
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

  it('the tooltip is decoration: the name a screen reader gets is on the link', () => {
    render(
      <MemoryRouter initialEntries={['/notebook']}>
        <TabBar />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'קבוצות' });
    expect(link).toHaveAttribute('title', 'קבוצות');
    // The visible tip repeats the word for a pointer and for keyboard focus,
    // and is hidden from assistive tech so it is not announced twice.
    const tip = [...link.querySelectorAll('span')].find((s) => s.textContent === 'קבוצות');
    expect(tip).toBeTruthy();
    expect(tip!.getAttribute('aria-hidden')).toBe('true');
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
