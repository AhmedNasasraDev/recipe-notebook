// /settings/privacy. Moved verbatim out of the old §20 one-page settings —
// see SettingsScreen.test.tsx's git history for where this used to live.

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SettingsPrivacyScreen } from './SettingsPrivacyScreen.js';
import { renderRoute } from '../test/render.js';

function show() {
  return renderRoute(<SettingsPrivacyScreen />, {
    path: '/settings/privacy',
    route: '/settings/privacy',
  });
}

describe('§12 privacy: stated, not faked', () => {
  it('states the privacy rules as rules, with nothing to toggle', async () => {
    show();
    expect(await screen.findByText(/המחברת שלכם פרטית/)).toBeInTheDocument();
    expect(screen.getByText(/אוכפת במסד הנתונים עצמו/)).toBeInTheDocument();
  });

  it('goes back to the settings list', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'הגדרות' })).toBeInTheDocument();
  });
});
