import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IdentityCard } from './IdentityCard.js';
import { ANONYMOUS_MEMBER } from './chat.js';
import { fakeRepository, renderRoute } from '../../test/render.js';
import type { FakeGroupOptions } from '../../test/fakeGroups.js';

const render_ = (groups: FakeGroupOptions = {}, canWrite = true) =>
  renderRoute(<IdentityCard />, {
    repository: fakeRepository({
      canWrite,
      source: canWrite ? 'supabase' : 'local-demo',
      groups,
    }),
  });

describe('the name a group sees', () => {
  it('shows the stored name', async () => {
    render_({ identity: { displayName: 'אחמד נסאסרה', avatarPath: null } });
    await waitFor(() => expect(screen.getByLabelText('השם שיוצג')).toHaveValue('אחמד נסאסרה'));
  });

  it('says what an empty name means, rather than leaving it a mystery', async () => {
    render_({ identity: { displayName: '', avatarPath: null } });
    expect(
      await screen.findByText(`בלי שם, חברי הקבוצה יראו ״${ANONYMOUS_MEMBER}״ במקום.`),
    ).toBeInTheDocument();
  });

  it('says the email address is never shown to a group', async () => {
    render_();
    expect(
      await screen.findByText(/כתובת\s*המייל שלכם אינה מוצגת לאף אחד בקבוצה/),
    ).toBeInTheDocument();
  });

  it('saves a change, and only offers to save once something changed', async () => {
    render_({ identity: { displayName: 'אחמד', avatarPath: null } });
    await waitFor(() => expect(screen.getByLabelText('השם שיוצג')).toHaveValue('אחמד'));
    expect(screen.getByRole('button', { name: 'שמירת השם' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('השם שיוצג'), ' נסאסרה');
    await userEvent.click(screen.getByRole('button', { name: 'שמירת השם' }));
    expect(await screen.findByText('נשמר')).toBeInTheDocument();
  });

  it('shows initials while there is no picture', async () => {
    render_({ identity: { displayName: 'אחמד נסאסרה', avatarPath: null } });
    expect(await screen.findByText('אנ')).toBeInTheDocument();
  });
});

describe('the picture', () => {
  it('uploads one and shows it', async () => {
    render_({
      identity: { displayName: 'אחמד', avatarPath: null },
      avatarUrls: { 'me/avatar.webp': 'blob:avatar' },
    });
    const input = await screen.findByLabelText('העלאת תמונה');
    await userEvent.upload(
      input,
      new File([new Uint8Array(10)], 'me.jpg', { type: 'image/jpeg' }),
    );
    await waitFor(() =>
      expect(document.querySelector('img[src="blob:avatar"]')).not.toBeNull(),
    );
  });

  it('offers to remove a picture only when there is one', async () => {
    render_({ identity: { displayName: 'אחמד', avatarPath: null } });
    await screen.findByLabelText('העלאת תמונה');
    expect(screen.queryByRole('button', { name: 'הסרת התמונה' })).not.toBeInTheDocument();
  });

  it('removes it', async () => {
    render_({
      identity: { displayName: 'אחמד', avatarPath: 'me/avatar.webp' },
      avatarUrls: { 'me/avatar.webp': 'blob:avatar' },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'הסרת התמונה' }));
    await waitFor(() =>
      expect(document.querySelector('img[src="blob:avatar"]')).toBeNull(),
    );
  });

  it('says the original data is dropped, including a location', async () => {
    render_();
    expect(
      await screen.findByText(/ללא נתוני המקור — כולל מיקום/),
    ).toBeInTheDocument();
  });

  it('reports a conversion failure instead of a silent nothing', async () => {
    const repo = fakeRepository({ canWrite: true, source: 'supabase' });
    const broken = {
      ...repo,
      setAvatar: async () => {
        throw new Error('הקובץ הזה אינו תמונה. אפשר להעלות JPG, PNG, HEIC או WebP.');
      },
    };
    renderRoute(<IdentityCard />, { repository: broken });
    // An image by type, refused by the CONVERSION rather than by the input:
    // `accept="image/*"` makes user-event drop a text/plain file before any
    // change event fires, so a non-image here would test the input and not
    // the failure path.
    await userEvent.upload(
      await screen.findByLabelText('העלאת תמונה'),
      new File([new Uint8Array(4)], 'broken.jpg', { type: 'image/jpeg' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('אינו תמונה');
  });
});

describe('a session with no server', () => {
  it('explains why nothing here can be changed', async () => {
    render_({}, false);
    expect(
      await screen.findByText(/בהתקנה הזאת אין חיבור לשרת, ולכן אי אפשר\s*לשנות אותם כאן/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('השם שיוצג')).toBeDisabled();
  });
});
