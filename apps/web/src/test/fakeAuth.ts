// A stand-in for `supabase.auth`.
//
// It models the three behaviours the provider actually branches on, because
// each one produces a different correct message on screen:
//
//   confirmEmail: true   signUp returns a user and NO session. The account is
//                        not usable yet and the screen must say so rather than
//                        pretending the user is in.
//   confirmEmail: false  signUp returns a user AND a session, and the app goes
//                        straight to onboarding.
//   an error             returned in `{ error }`, never thrown — which is what
//                        supabase-js does, and is easy to forget.
//
// It also keeps a session across instances via `storedSession`, so a test can
// reproduce the one thing a mock usually cannot: a page reload that must land
// back in the notebook without a trip through the sign-in screen.

export interface FakeUser {
  id: string;
  email: string;
}

export interface FakeSession {
  access_token: string;
  user: FakeUser;
}

type Listener = (event: string, session: FakeSession | null) => void;

export interface FakeAuthOptions {
  /** whether the project requires an emailed confirmation before the first sign-in */
  confirmEmail?: boolean;
  /** a session already persisted from an earlier visit */
  storedSession?: FakeSession | null;
  /** accounts that already exist, as email -> password */
  accounts?: Record<string, { id: string; password: string; confirmed: boolean }>;
  /** makes getSession() reject, for the failed-restore path */
  failRestore?: boolean;
}

export interface FakeAuthClient {
  client: unknown;
  /** what a test asserts against: the session the client currently holds */
  session(): FakeSession | null;
  signOutCalls: number;
  /** how many times a password was actually written */
  passwordChanges: number;
  /** the password an account currently has, for asserting a change took */
  passwordOf(email: string): string | undefined;
  /** pushes an external change, e.g. a sign-out in another tab */
  emit(event: string, session: FakeSession | null): void;
}

let userSeq = 0;

export function createFakeAuth(opts: FakeAuthOptions = {}): FakeAuthClient {
  const confirmEmail = opts.confirmEmail ?? false;
  const accounts = { ...(opts.accounts ?? {}) };
  let session: FakeSession | null = opts.storedSession ?? null;
  const listeners = new Set<Listener>();
  const out = {
    signOutCalls: 0,
    passwordChanges: 0,
  };

  const emit = (event: string, next: FakeSession | null) => {
    session = next;
    for (const l of [...listeners]) l(event, next);
  };

  const auth = {
    async getSession() {
      if (opts.failRestore) throw new Error('storage unavailable');
      return { data: { session }, error: null };
    },

    onAuthStateChange(cb: Listener) {
      listeners.add(cb);
      return {
        data: { subscription: { unsubscribe: () => listeners.delete(cb) } },
      };
    },

    async signUp({ email, password }: { email: string; password: string }) {
      if (accounts[email]) {
        return {
          data: { user: null, session: null },
          error: { message: 'User already registered' },
        };
      }
      if (password.length < 6) {
        return {
          data: { user: null, session: null },
          error: { message: 'Password should be at least 6 characters' },
        };
      }
      const id = `user-${++userSeq}`;
      accounts[email] = { id, password, confirmed: !confirmEmail };
      const user: FakeUser = { id, email };

      if (confirmEmail) {
        // The tell-tale shape: a user, but no session.
        return { data: { user, session: null }, error: null };
      }
      const next: FakeSession = { access_token: `token-${id}`, user };
      emit('SIGNED_IN', next);
      return { data: { user, session: next }, error: null };
    },

    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const account = accounts[email];
      if (!account || account.password !== password) {
        return {
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials' },
        };
      }
      if (!account.confirmed) {
        return {
          data: { user: null, session: null },
          error: { message: 'Email not confirmed' },
        };
      }
      const user: FakeUser = { id: account.id, email };
      const next: FakeSession = { access_token: `token-${account.id}`, user };
      emit('SIGNED_IN', next);
      return { data: { user, session: next }, error: null };
    },

    /**
     * Stage 11. GoTrue's own `updateUser` changes the password from a live
     * session alone; the app's `changePassword` re-authenticates first, so this
     * double records the new password and the tests can then prove the old one
     * stops working and the new one starts.
     */
    async updateUser({ password }: { password?: string }) {
      const current = session;
      if (!current) {
        return { data: { user: null }, error: { message: 'Auth session missing!' } };
      }
      if (password !== undefined) {
        if (password.length < 6) {
          return {
            data: { user: null },
            error: { message: 'Password should be at least 6 characters' },
          };
        }
        const account = accounts[current.user.email];
        if (account) account.password = password;
        out.passwordChanges += 1;
      }
      return { data: { user: current.user }, error: null };
    },

    async signOut() {
      out.signOutCalls += 1;
      emit('SIGNED_OUT', null);
      return { error: null };
    },
  };

  return {
    client: { auth, from: () => { throw new Error('not used in auth tests'); } },
    session: () => session,
    get signOutCalls() {
      return out.signOutCalls;
    },
    get passwordChanges() {
      return out.passwordChanges;
    },
    passwordOf: (email: string) => accounts[email]?.password,
    emit,
  };
}

export const CONFIRMED_ACCOUNT = {
  'ahmed@test.invalid': { id: 'user-ahmed', password: 'sourdough1', confirmed: true },
};
