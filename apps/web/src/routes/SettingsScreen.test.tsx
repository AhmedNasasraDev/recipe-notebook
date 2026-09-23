// §20 "הגדרות" — the category hub.
//
// Personal Settings, stage 2: this screen used to hold every setting as a
// stack of cards on one page. It is now a plain list of five categories, and
// what each category does is tested on its own screen (SettingsProfileScreen,
// SettingsLanguageScreen, SettingsRecipePreferencesScreen,
// SettingsPrivacyScreen, SettingsBackupScreen). This file only tests that the
// hub lists the right categories and that each links to the right place.

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SettingsScreen } from './SettingsScreen.js';
import { renderRoute } from '../test/render.js';

const CATEGORIES: readonly [name: RegExp, href: string][] = [
  [/פרטים אישיים/, '/settings/profile'],
  [/^שפה /, '/settings/language'],
  [/העדפות מתכונים/, '/settings/recipe-preferences'],
  [/פרטיות ואבטחה/, '/settings/privacy'],
  [/גיבוי ונתונים/, '/settings/backup'],
];

function show() {
  return renderRoute(<SettingsScreen />, { path: '/settings', route: '/settings' });
}

describe('the settings hub', () => {
  it('lists exactly the five built categories, each linking to its own screen', async () => {
    show();
    for (const [name, href] of CATEGORIES) {
      const link = await screen.findByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
    }
    // Categories not built yet (notifications, course preferences) are not
    // listed — a card that leads nowhere real is worse than no card.
    expect(screen.getAllByRole('link')).toHaveLength(CATEGORIES.length);
  });

  it('goes back to "עוד"', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'עוד' })).toBeInTheDocument();
  });
});
