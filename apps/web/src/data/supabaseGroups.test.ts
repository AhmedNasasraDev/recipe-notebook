import { describe, expect, it, vi } from 'vitest';
import { createSupabaseGroups, messageFromBroadcast } from './supabaseGroups.js';
import { WriteNotAllowedError } from './repository.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';
import type { GroupMessageRow } from '../lib/database.types.js';

/*
  A fake PostgREST client.

  Not a mock of the repository — a mock of the WIRE, so these tests can assert
  the two things that are invisible from above the seam:

    1. What is actually sent. `editMessage` must not send `edited_at` and
       `deleteMessage` must not send `body`: both are stamped by a trigger, and
       a client that sent its own values would be deciding something the
       database decided for a reason.
    2. What happens when a write affects NO ROWS. That is what RLS refusing an
       UPDATE or DELETE looks like from here — 200, empty body, no error — and
       a client that does not check reports success for a refused write.

  The chain is recorded rather than replayed: a test asks what was called with
  what, which is how "did it use a keyset cursor or an offset" gets checked.
*/

interface Call {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'rpc';
  payload?: unknown;
  filters: Array<{ fn: string; column?: string; value?: unknown }>;
  selected?: string;
  limit?: number;
}

function fakeClient(responses: Record<string, { data: unknown; error?: unknown }>) {
  const calls: Call[] = [];
  const storage: Array<{ op: string; bucket: string; args: unknown[] }> = [];

  const builder = (call: Call) => {
    const key = `${call.table}.${call.op}`;
    const result = () => {
      const r = responses[key] ?? responses[call.table] ?? { data: null };
      return { data: r.data, error: r.error ?? null };
    };
    const self: Record<string, unknown> = {
      select(cols?: string) {
        call.selected = cols;
        if (call.op === 'rpc') return self;
        if (call.op === 'select') call.selected = cols;
        return self;
      },
      eq(column: string, value: unknown) {
        call.filters.push({ fn: 'eq', column, value });
        return self;
      },
      lt(column: string, value: unknown) {
        call.filters.push({ fn: 'lt', column, value });
        return self;
      },
      order(column: string, opts?: unknown) {
        call.filters.push({ fn: 'order', column, value: opts });
        return self;
      },
      limit(n: number) {
        call.limit = n;
        return self;
      },
      single() {
        const r = result();
        const row = Array.isArray(r.data) ? r.data[0] : r.data;
        return Promise.resolve({ data: row, error: r.error });
      },
      maybeSingle() {
        const r = result();
        const row = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return Promise.resolve({ data: row, error: r.error });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve);
      },
    };
    return self;
  };

  const client = {
    from(table: string) {
      return {
        select(cols?: string) {
          const call: Call = { table, op: 'select', filters: [], selected: cols };
          calls.push(call);
          return builder(call);
        },
        insert(payload: unknown) {
          const call: Call = { table, op: 'insert', payload, filters: [] };
          calls.push(call);
          return builder(call);
        },
        update(payload: unknown) {
          const call: Call = { table, op: 'update', payload, filters: [] };
          calls.push(call);
          return builder(call);
        },
        delete() {
          const call: Call = { table, op: 'delete', filters: [] };
          calls.push(call);
          return builder(call);
        },
      };
    },
    rpc(name: string, args?: unknown) {
      const call: Call = { table: name, op: 'rpc', payload: args, filters: [] };
      calls.push(call);
      return builder(call);
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUrls(...args: unknown[]) {
            storage.push({ op: 'createSignedUrls', bucket, args });
            const r = responses['storage.createSignedUrls'] ?? { data: null };
            return Promise.resolve({ data: r.data, error: r.error ?? null });
          },
          createSignedUrl(...args: unknown[]) {
            storage.push({ op: 'createSignedUrl', bucket, args });
            const r = responses['storage.createSignedUrl'] ?? { data: null };
            return Promise.resolve({ data: r.data, error: r.error ?? null });
          },
          remove(...args: unknown[]) {
            storage.push({ op: 'remove', bucket, args });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
    realtime: { setAuth: vi.fn(async () => undefined) },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  };

  return { client: client as unknown as TypedSupabaseClient, calls, storage, raw: client };
}

const ONLINE = (): void => {};

const row = (over: Partial<GroupMessageRow> & { seq: number }): GroupMessageRow => ({
  id: `m${over.seq}`,
  group_id: 'g1',
  channel_id: null,
  author_id: 'them',
  body: `שורה ${over.seq}`,
  kind: 'text',
  reply_to_id: null,
  edited_at: null,
  deleted_at: null,
  deleted_by: null,
  created_at: '2026-09-17T10:00:00Z',
  ...over,
});

describe('a write that affects no rows is a refusal, not a success', () => {
  it('refuses a role change that matched nothing', async () => {
    const { client } = fakeClient({ 'group_members.update': { data: [] } });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await expect(repo.setMemberRole('g1', 'them', 'admin')).rejects.toBeInstanceOf(
      WriteNotAllowedError,
    );
  });

  it('refuses a group update that matched nothing', async () => {
    const { client } = fakeClient({ 'groups.update': { data: [] } });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await expect(repo.updateGroup('g1', { name: 'שם חדש' })).rejects.toBeInstanceOf(
      WriteNotAllowedError,
    );
  });

  it('refuses a delete that matched nothing', async () => {
    const { client } = fakeClient({ 'groups.delete': { data: [] } });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await expect(repo.deleteGroup('g1')).rejects.toBeInstanceOf(WriteNotAllowedError);
  });

  it('refuses a message delete that matched nothing', async () => {
    const { client } = fakeClient({ 'group_messages.update': { data: [] } });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await expect(repo.deleteMessage('m1')).rejects.toBeInstanceOf(WriteNotAllowedError);
  });

  it('says "no permission, or it does not exist" and not one or the other', async () => {
    // The database cannot tell them apart either, and inventing the
    // distinction would disclose which ids exist.
    const { client } = fakeClient({ 'group_members.delete': { data: [] } });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await expect(repo.removeMember('g1', 'them')).rejects.toThrow(/הרשאה|אינו קיים/);
  });

  it('accepts a write that did affect a row', async () => {
    const { client } = fakeClient({ 'group_members.update': { data: [{ user_id: 'them' }] } });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await expect(repo.setMemberRole('g1', 'them', 'member')).resolves.toBeUndefined();
  });
});

describe('what the chat actually sends', () => {
  it('does not send edited_at on an edit — the trigger stamps it', async () => {
    const { client, calls } = fakeClient({
      'group_messages.update': { data: [row({ seq: 4, body: 'תוקן', author_id: 'me' })] },
    });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await repo.editMessage('m4', 'תוקן');
    const update = calls.find((c) => c.op === 'update');
    expect(update?.payload).toEqual({ body: 'תוקן' });
  });

  it('does not send a body on a delete — the words leave the row (0035)', async () => {
    const { client, calls } = fakeClient({ 'group_messages.update': { data: [{ id: 'm4' }] } });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await repo.deleteMessage('m4');
    const update = calls.find((c) => c.op === 'update');
    expect(Object.keys(update?.payload as object)).toEqual(['deleted_at']);
  });

  it('sends the author id itself, which the insert policy then checks', async () => {
    const { client, calls } = fakeClient({
      'group_messages.insert': { data: row({ seq: 7, author_id: 'me' }) },
    });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await repo.sendMessage({ groupId: 'g1', body: 'שלום' });
    expect(calls[0]?.payload).toMatchObject({ author_id: 'me', group_id: 'g1', kind: 'text' });
  });
});

describe('chatPage is keyset, not offset', () => {
  it('asks for one row more than it wants, and reports there is more', async () => {
    const { client, calls } = fakeClient({
      'group_messages.select': { data: [row({ seq: 5 }), row({ seq: 4 }), row({ seq: 3 })] },
    });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    const page = await repo.chatPage('g1', null, 2);
    expect(calls[0]?.limit).toBe(3);
    expect(page.hasMore).toBe(true);
    expect(page.messages).toHaveLength(2);
  });

  it('returns the page oldest-first, which is reading order', async () => {
    const { client } = fakeClient({
      'group_messages.select': { data: [row({ seq: 5 }), row({ seq: 4 })] },
    });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    const page = await repo.chatPage('g1', null, 10);
    expect(page.messages.map((m) => m.seq)).toEqual([4, 5]);
    expect(page.hasMore).toBe(false);
  });

  it('adds `seq <` only when paging back, and never an offset', async () => {
    const { client, calls } = fakeClient({ 'group_messages.select': { data: [] } });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await repo.chatPage('g1', null, 10);
    expect(calls[0]?.filters.some((f) => f.fn === 'lt')).toBe(false);
    await repo.chatPage('g1', 40, 10);
    expect(calls[1]?.filters).toEqual(
      expect.arrayContaining([{ fn: 'lt', column: 'seq', value: 40 }]),
    );
  });
});

describe('messageFromBroadcast', () => {
  const payload = (record: unknown) => ({ payload: { operation: 'INSERT', record } });

  it('reads the record `realtime.broadcast_changes` sends', () => {
    const m = messageFromBroadcast(payload(row({ seq: 9 })));
    expect(m?.seq).toBe(9);
    expect(m?.groupId).toBe('g1');
  });

  it('accepts the record at the top level too', () => {
    expect(messageFromBroadcast({ record: row({ seq: 2 }) })?.seq).toBe(2);
  });

  it('turns a bigint arriving as a string into a number', () => {
    // int8 can serialise either way depending on the path; ordering must not
    // depend on which.
    const m = messageFromBroadcast(payload({ ...row({ seq: 3 }), seq: '3' }));
    expect(m?.seq).toBe(3);
  });

  it('answers null for anything it does not recognise, including a DELETE', () => {
    expect(messageFromBroadcast(null)).toBeNull();
    expect(messageFromBroadcast({})).toBeNull();
    expect(messageFromBroadcast(payload({ id: 'x' }))).toBeNull();
    // A delete would carry old_record only. There is none today (0034 revoked
    // the privilege), and rendering one as a live message would be wrong.
    expect(messageFromBroadcast({ payload: { operation: 'DELETE', old_record: row({ seq: 1 }) } }))
      .toBeNull();
  });

  it('defaults a missing body to empty rather than undefined', () => {
    const m = messageFromBroadcast(payload({ ...row({ seq: 4 }), body: undefined }));
    expect(m?.body).toBe('');
  });
});

describe('the realtime subscription', () => {
  it('opens a PRIVATE channel on the group topic and authorises it', async () => {
    const { client, raw } = fakeClient({});
    const handlers: Array<(p: unknown) => void> = [];
    const channel = {
      on: vi.fn((_type: string, _filter: unknown, cb: (p: unknown) => void) => {
        handlers.push(cb);
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    raw.channel.mockReturnValue(channel);

    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    const seen: number[] = [];
    const sub = repo.subscribeGroupChat('g1', { onMessage: (m) => seen.push(m.seq) });
    await vi.waitFor(() => expect(channel.subscribe).toHaveBeenCalled());

    expect(raw.channel).toHaveBeenCalledWith('group:g1', { config: { private: true } });
    // Without setAuth the join is anonymous and the policy on
    // realtime.messages refuses it.
    expect(raw.realtime.setAuth).toHaveBeenCalled();

    handlers[0]?.({ payload: { record: row({ seq: 11 }) } });
    expect(seen).toEqual([11]);

    // A message for another group must never reach this subscriber. The
    // channel is per group, so this cannot happen from the server — the check
    // is here because "cannot happen" is how a chat leaks into the wrong room.
    handlers[0]?.({ payload: { record: row({ seq: 12, group_id: 'other' }) } });
    expect(seen).toEqual([11]);

    sub.unsubscribe();
    expect(raw.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('reports an error rather than waiting forever when the token fails', async () => {
    const { client, raw } = fakeClient({});
    raw.realtime.setAuth.mockRejectedValueOnce(new Error('no session'));
    raw.channel.mockReturnValue({ on: vi.fn(), subscribe: vi.fn() });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    const statuses: string[] = [];
    repo.subscribeGroupChat('g1', { onMessage: () => {}, onStatus: (s) => statuses.push(s) });
    await vi.waitFor(() => expect(statuses).toContain('error'));
  });
});

describe('avatars', () => {
  it('keeps only the rows that came back with a URL', async () => {
    const { client, storage } = fakeClient({
      'storage.createSignedUrls': {
        data: [
          { path: 'a/1.webp', signedUrl: 'https://x/1', error: null },
          { path: 'b/2.webp', signedUrl: null, error: 'not found' },
        ],
      },
    });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    const urls = await repo.avatarUrls(['a/1.webp', 'b/2.webp', 'a/1.webp', '']);
    expect(urls).toEqual({ 'a/1.webp': 'https://x/1' });
    // Asked once per distinct path, and never for the empty one.
    expect(storage[0]?.args[0]).toEqual(['a/1.webp', 'b/2.webp']);
  });

  it('returns an empty map rather than throwing when signing fails', async () => {
    // A members list must not disappear because a picture could not be signed.
    const { client } = fakeClient({
      'storage.createSignedUrls': { data: null, error: { message: 'nope' } },
    });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await expect(repo.avatarUrls(['a/1.webp'])).resolves.toEqual({});
  });

  it('answers null for no avatar at all, without asking storage', async () => {
    const { client, storage } = fakeClient({});
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await expect(repo.avatarUrl(null)).resolves.toBeNull();
    expect(storage).toHaveLength(0);
  });
});

describe('item permissions', () => {
  it('maps the five booleans onto the five columns', async () => {
    const { client, calls } = fakeClient({
      'group_recipe_items.update': { data: [{ id: 'i1' }] },
    });
    const repo = createSupabaseGroups({ client, userId: 'me', requireOnline: ONLINE });
    await repo.setItemPerms('i1', {
      view: true,
      save: true,
      print: false,
      download: false,
      shareOut: true,
    });
    expect(calls[0]?.payload).toEqual({
      perm_view: true,
      perm_save: true,
      perm_print: false,
      perm_download: false,
      perm_share_out: true,
    });
  });
});
