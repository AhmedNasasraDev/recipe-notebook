import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinScreen } from './JoinScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';
import type { FakeGroupOptions, FakeGroupSeed } from '../test/fakeGroups.js';

const seed: FakeGroupSeed = {
  id: 'g1',
  name: 'קונדיטוריה',
  kind: '',
  note: '',
  code: null,
  joinBy: ['invite'],
  myRole: 'member',
  roster: [],
  courses: [],
};

const render_ = (groups: FakeGroupOptions = {}, token = 'good-token') =>
  renderRoute(<JoinScreen />, {
    path: '/join/:token',
    route: `/join/${token}`,
    repository: fakeRepository({
      canWrite: true,
      source: 'supabase',
      groups: { groups: [seed], validToken: 'good-token', ...groups },
    }),
  });

describe('the invitation link', () => {
  it('asks rather than joining on arrival', async () => {
    // A link that redeemed on load would let a chat preview or a mail scanner
    // join the group and burn a single-use invitation.
    const onRedeemInvite = vi.fn();
    render_({ onRedeemInvite });
    expect(await screen.findByRole('button', { name: 'הצטרפות לקבוצה' })).toBeInTheDocument();
    expect(onRedeemInvite).not.toHaveBeenCalled();
  });

  it('never shows the token — it is a bearer credential', async () => {
    render_();
    await screen.findByRole('button', { name: 'הצטרפות לקבוצה' });
    expect(screen.queryByText(/good-token/)).not.toBeInTheDocument();
  });

  it('states the privacy model before the person decides', async () => {
    render_();
    expect(
      await screen.findByText(/המחברת האישית שלכם נשארת פרטית/),
    ).toBeInTheDocument();
  });

  it('joins and moves to the group', async () => {
    const onRedeemInvite = vi.fn();
    render_({ onRedeemInvite });
    await userEvent.click(await screen.findByRole('button', { name: 'הצטרפות לקבוצה' }));
    expect(onRedeemInvite).toHaveBeenCalledWith('good-token');
  });

  it('gives ONE message for every kind of failure', async () => {
    // Wrong address, expired, revoked, used, unknown: one sentence, because a
    // distinguishable error is a way to test whether an address is registered.
    render_({}, 'wrong-token');
    await userEvent.click(await screen.findByRole('button', { name: 'הצטרפות לקבוצה' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ההזמנה אינה תקפה');
    expect(alert).toHaveTextContent('שפג תוקפה');
    expect(alert).toHaveTextContent('נשלחה לכתובת אחרת');
  });

  it('declines, and says the link will not work again', async () => {
    render_();
    await userEvent.click(await screen.findByRole('button', { name: 'לא תודה' }));
    expect(await screen.findByText('ההזמנה נדחתה')).toBeInTheDocument();
    expect(screen.getByText(/הקישור הזה לא יעבוד יותר/)).toBeInTheDocument();
  });

  it('tells somebody on a server-less build that their link is still valid', async () => {
    // The local demo repository cannot redeem anything. Saying "invalid" would
    // be wrong and would waste a single-use token.
    renderRoute(<JoinScreen />, {
      path: '/join/:token',
      route: '/join/good-token',
      repository: fakeRepository({
        groups: {
          groups: [],
        },
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'הצטרפות לקבוצה' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
