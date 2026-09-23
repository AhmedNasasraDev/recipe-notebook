import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeasurementPrefs } from '@recipe-notebook/engine';
import { defaultPrefs } from '@recipe-notebook/engine';
import { OnboardingScreen } from './OnboardingScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';

function setup(prefs?: MeasurementPrefs) {
  const saved: MeasurementPrefs[] = [];
  const repository = fakeRepository({
    prefs: prefs ?? { ...defaultPrefs('pro'), done: false },
    onSavePrefs: (p) => saved.push(p),
  });
  renderRoute(<OnboardingScreen />, { path: '/', route: '/', repository });
  return { saved, user: userEvent.setup() };
}

describe('§4 onboarding — three steps, once', () => {
  it('opens on the profile question', async () => {
    setup();
    expect(await screen.findByText('איך נוח לכם לעבוד?')).toBeInTheDocument();
    for (const p of ['ביתי', 'מקצועי', 'לימוד']) {
      expect(screen.getByText(p)).toBeInTheDocument();
    }
  });

  it('hides "הקודם" on the first step and shows it later', async () => {
    const { user } = setup();
    await screen.findByText('איך נוח לכם לעבוד?');
    expect(screen.queryByRole('button', { name: 'הקודם' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    expect(screen.getByRole('button', { name: 'הקודם' })).toBeInTheDocument();
  });

  it('step 2 groups the units and carries the fixed oz / fl oz warning', async () => {
    const { user } = setup();
    await screen.findByText('איך נוח לכם לעבוד?');
    await user.click(screen.getByRole('button', { name: 'המשך' }));

    expect(screen.getByText('איך נוח לכם למדוד במתכונים?')).toBeInTheDocument();
    for (const g of ['משקל', 'נפח', 'מדידות ביתיות', 'יחידות', 'בר וקפה']) {
      expect(screen.getByRole('heading', { name: g })).toBeInTheDocument();
    }
    expect(
      screen.getByText(/oz הוא משקל. fl oz הוא נפח/),
    ).toBeInTheDocument();
  });

  it('step 3 offers the five cup sizes from §4', async () => {
    const { user } = setup();
    await screen.findByText('איך נוח לכם לעבוד?');
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    await user.click(screen.getByRole('button', { name: 'המשך' }));

    expect(screen.getByText('מה גודל כלי המדידה שלכם?')).toBeInTheDocument();
    expect(screen.getByText(/תקן מטבח בינלאומי/)).toBeInTheDocument();
    expect(screen.getByText(/כוס מטרית/)).toBeInTheDocument();
    expect(screen.getByText(/כוס אמריקאית/)).toBeInTheDocument();
  });

  it('§4 validation: finishing with no choices at all still works', async () => {
    const { user, saved } = setup();
    await screen.findByText('איך נוח לכם לעבוד?');
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    await user.click(screen.getByRole('button', { name: 'סיום, לפתוח את המחברת' }));
    expect(saved.at(-1)?.done).toBe(true);
  });

  it('choosing a tool size persists it, because every conversion depends on it', async () => {
    const { user, saved } = setup();
    await screen.findByText('איך נוח לכם לעבוד?');
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    await user.click(screen.getByRole('button', { name: /250 מ"ל — כוס מטרית/ }));
    expect(saved.at(-1)?.tools?.cup).toBe(250);
  });

  it('§3: switching profile sets its default units while touchedUnits is false', async () => {
    const { user, saved } = setup();
    await screen.findByText('איך נוח לכם לעבוד?');
    await user.click(screen.getByText('ביתי'));
    expect(saved.at(-1)?.profile).toBe('home');
    expect(saved.at(-1)?.pro).toBe(false);
    expect(saved.at(-1)?.units).toContain('cup');
  });

  it('§3: once the user has touched units, a profile change leaves them alone', async () => {
    const { user, saved } = setup({
      ...defaultPrefs('pro'),
      done: false,
      touchedUnits: true,
      units: ['g'],
    });
    await screen.findByText('איך נוח לכם לעבוד?');
    await user.click(screen.getByText('ביתי'));
    expect(saved.at(-1)?.units).toEqual(['g']);
  });

  it('toggling a unit marks units as touched', async () => {
    const { user, saved } = setup();
    await screen.findByText('איך נוח לכם לעבוד?');
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    const group = screen.getByRole('heading', { name: 'משקל' }).parentElement!;
    await user.click(within(group).getByRole('button', { name: 'אונקיה' }));
    expect(saved.at(-1)?.touchedUnits).toBe(true);
    expect(saved.at(-1)?.units).toContain('oz');
  });
});
