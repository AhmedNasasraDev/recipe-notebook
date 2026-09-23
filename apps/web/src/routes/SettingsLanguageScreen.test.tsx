// /settings/language. Moved verbatim out of the old §20 one-page settings —
// see SettingsScreen.test.tsx's git history for where this used to live.

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SettingsLanguageScreen } from './SettingsLanguageScreen.js';
import { renderRoute } from '../test/render.js';

function show() {
  return renderRoute(<SettingsLanguageScreen />, {
    path: '/settings/language',
    route: '/settings/language',
  });
}

describe('§17 language: stated, not faked', () => {
  it('says Arabic is planned rather than offering a switch that does nothing', async () => {
    show();
    expect(await screen.findByText(/ערבית מתוכננת לשלב הבא/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ערבית/ })).not.toBeInTheDocument();
  });

  it('goes back to the settings list', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'הגדרות' })).toBeInTheDocument();
  });
});
