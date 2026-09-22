// Authentication (HANDOFF §2).
//
// One provider owns the session and nothing else in the app talks to
// `supabase.auth` directly. Three things follow from that:
//
//   • the repository can be chosen from `status` in one place
//   • a screen asks "am I signed in", never "is there a JWT in localStorage"
//   • signing out can clear the offline mirror, which matters: the mirror is a
//     plaintext copy of one account's recipes and preferences on a device that
//     may be shared
//
// `status` has four values and they are not interchangeable:
//
//   loading      — the stored session is still being restored. Rendering the
//                  sign-in screen here would flash it at a signed-in user on
//                  every page load.
//   unconfigured — no Supabase project in this checkout's .env.local. The app
//                  runs on the read-only demo repository and says so. This is a
//                  normal developer state, not an error.
//   signed-out   — configured, nobody signed in.
//   signed-in    — configured, session in hand.
//
// Passwords are never held in state, never logged, and never written to the
// mirror. Supabase stores the session itself; this provider only reads it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, supabaseStatus, type TypedSupabaseClient } from '../lib/supabase.js';
import { clearMirror } from '../data/offlineMirror.js';

export type AuthStatus = 'loading' | 'unconfigured' | 'signed-out' | 'signed-in';

/**
 * What a confirmation / recovery link that FAILED says in the address.
 *
 * GoTrue sends a person back with `#error=access_denied&error_code=otp_expired
 * &error_description=…` when the link is stale or already used. The client
 * library reads that fragment, throws inside `getSession()`, and clears the
 * hash — so by the time a screen renders there is nothing left to explain
 * why the person is looking at a sign-in form. This is read once, at module
 * load, before the client exists.
 */
export interface RedirectError {
  code: string;
  description: string;
}

function readRedirectError(): RedirectError | null {
  if (typeof window === 'undefined') return null;
  const read = (raw: string): RedirectError | null => {
    const params = new URLSearchParams(raw.replace(/^[#?]/, ''));
    const code = params.get('error_code') ?? params.get('error') ?? '';
    const description = params.get('error_description') ?? '';
    return code || description ? { code, description } : null;
  };
  return read(window.location.hash) ?? read(window.location.search);
}

const REDIRECT_ERROR: RedirectError | null = readRedirectError();

/** The Hebrew for a failed link, or null when the address carried no error. */
export function redirectErrorText(err: RedirectError | null): string | null {
  if (!err) return null;
  const d = err.description.toLowerCase();
  if (err.code === 'otp_expired' || d.includes('expired') || d.includes('invalid')) {
    return 'קישור האימות פג או כבר נוצל. אם החשבון עדיין לא אושר, הרשמה חוזרת עם אותו אימייל שולחת קישור חדש; אם הוא כבר אושר, אפשר להתחבר.';
  }
  if (err.code === 'access_denied') {
    return 'הקישור לא התקבל על ידי השרת. אפשר להתחבר, או להירשם שוב עם אותו אימייל כדי לקבל קישור חדש.';
  }
  return `הקישור לא עבד (${err.code || 'שגיאה'}): ${err.description || 'ללא פירוט'}.`;
}

export interface SignUpOutcome {
  /** true when Supabase is configured to require an emailed confirmation first */
  needsEmailConfirmation: boolean;
}

export interface Auth {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** null unless Supabase is configured */
  client: TypedSupabaseClient | null;
  /** why Supabase is not in use, for the banner */
  unconfiguredReason: 'missing-env' | 'service-role-key-in-browser' | null;
  /** the error a failed confirmation link arrived with, in Hebrew; null when none */
  redirectError: string | null;
  signUp(email: string, password: string): Promise<SignUpOutcome>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Changes the signed-in account's password.
   *
   * The CURRENT password is required and is verified first, by signing in with
   * it. GoTrue's `updateUser` does not ask for it — a live session is enough —
   * which means an unattended browser is enough to lock the owner out of their
   * own account. Checking it costs one request and closes that.
   */
  changePassword(current: string, next: string): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

/**
 * Supabase returns English error strings. Mapping them keeps the whole UI in
 * one language, and keeps "wrong password" from arriving as a raw API message.
 * Anything unmapped falls through unchanged rather than being swallowed — an
 * unexpected failure must stay visible.
 */
export function authErrorInHebrew(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'האימייל או הסיסמה אינם נכונים.';
  }
  if (m.includes('email not confirmed')) {
    return 'החשבון עדיין לא אושר. יש לאשר את הקישור שנשלח באימייל ואז להתחבר.';
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'קיים כבר חשבון עם האימייל הזה. אפשר להתחבר איתו.';
  }
  if (m.includes('password should be at least')) {
    const digits = /(\d+)/.exec(message)?.[1];
    return `הסיסמה קצרה מדי. נדרשים לפחות ${digits ?? 6} תווים.`;
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'כתובת האימייל אינה תקינה.';
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return 'יותר מדי נסיונות. נסו שוב בעוד דקה.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.';
  }
  return message;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(authErrorInHebrew(message));
    this.name = 'AuthError';
  }
}

export function AuthProvider({
  children,
  /** injected in tests, so no test needs a live project */
  client: injected,
}: {
  children: ReactNode;
  client?: TypedSupabaseClient | null;
}) {
  const status0 = supabaseStatus();
  const client = useMemo(
    () => (injected !== undefined ? injected : getSupabase()),
    [injected],
  );

  const [status, setStatus] = useState<AuthStatus>(() =>
    client ? 'loading' : 'unconfigured',
  );
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!client) {
      setStatus('unconfigured');
      return;
    }

    let cancelled = false;

    // Restore first, then subscribe. getSession() reads the persisted session,
    // so a refresh or a new tab lands back in the notebook without a round trip
    // through the sign-in screen.
    void client.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session ?? null);
        setStatus(data.session ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        // A failed restore is a signed-out session, not a broken app.
        if (!cancelled) setStatus('signed-out');
      });

    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      setSession(next ?? null);
      setStatus(next ? 'signed-in' : 'signed-out');
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [client]);

  const signUp = useCallback(
    async (email: string, password: string): Promise<SignUpOutcome> => {
      if (!client) throw new AuthError('אין חיבור לשרת, ולכן לא ניתן ליצור חשבון.');
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) throw new AuthError(error.message);

      // §2: whether a confirmation email is required is a project setting, not
      // something this client decides. Supabase signals "confirmation required"
      // by returning a user with no session, so that is what is reported —
      // rather than claiming the account is ready when it is not.
      return { needsEmailConfirmation: Boolean(data.user) && !data.session };
    },
    [client],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!client) throw new AuthError('אין חיבור לשרת, ולכן לא ניתן להתחבר.');
      const { error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw new AuthError(error.message);
    },
    [client],
  );

  const changePassword = useCallback(
    async (current: string, next: string) => {
      if (!client) {
        throw new AuthError('אין חיבור לשרת, ולכן לא ניתן לשנות סיסמה.');
      }
      const email = session?.user?.email;
      if (!email) throw new AuthError('אין חשבון מחובר.');
      if (next.length < 6) {
        throw new AuthError('הסיסמה החדשה קצרה מדי. נדרשים לפחות 6 תווים.');
      }
      if (next === current) {
        throw new AuthError('הסיסמה החדשה זהה לנוכחית.');
      }

      // Re-authenticate before changing anything. A wrong current password
      // comes back as "invalid login credentials", which the message map turns
      // into Hebrew — and nothing is written.
      const { error: checkError } = await client.auth.signInWithPassword({
        email,
        password: current,
      });
      if (checkError) {
        throw new AuthError(
          checkError.message.toLowerCase().includes('invalid login credentials')
            ? 'הסיסמה הנוכחית אינה נכונה.'
            : checkError.message,
        );
      }

      const { error } = await client.auth.updateUser({ password: next });
      if (error) throw new AuthError(error.message);
    },
    [client, session],
  );

  const signOut = useCallback(async () => {
    // The mirror is cleared BEFORE the session goes, so a failure leaves the
    // user still signed in with an intact cache rather than signed out with
    // someone else's recipes still on the device.
    await clearMirror();
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw new AuthError(error.message);
  }, [client]);

  const value = useMemo<Auth>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      client,
      unconfiguredReason: status0.configured ? null : status0.reason,
      redirectError: redirectErrorText(REDIRECT_ERROR),
      signUp,
      signIn,
      signOut,
      changePassword,
    }),
    [status, session, client, status0, signUp, signIn, signOut, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * For code that must work both inside and outside the provider.
 *
 * `AppDataProvider` is the one caller: a screen test renders it with a fake
 * repository and no auth at all, and that has to keep working — otherwise every
 * stage-2 test would need an auth wrapper it has no use for.
 */
export function useOptionalAuth(): Auth | null {
  return useContext(AuthContext);
}
