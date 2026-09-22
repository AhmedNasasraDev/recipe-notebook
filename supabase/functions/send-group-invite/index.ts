// send-group-invite — the invitation email, sent from the server.
//
// DEPLOYED, AND ONE DISCREPANCY WORTH KNOWING ABOUT
//
// Version 2 is live on project qxdpsomelzpvphkhkqrw (status ACTIVE,
// verify_jwt on), deployed 22.09.2026 with the CORS answer below. The deployed
// copy is this code EXACTLY, with this header abbreviated to a pointer at this
// file — the deploy went through a tool that takes the source inline, and the
// commentary is long. The next `supabase functions deploy send-group-invite`
// from this repository replaces it with this file verbatim.
//
// VERIFIED RUNNING from the browser on 22.09.2026: the preflight is answered,
// the POST reaches the function with the caller's token, and without the mail
// secrets it answers `{ sent: false, reason: "שירות המייל אינו מחובר…" }`,
// which the screen shows. Version 1 answered no preflight, so every call from
// the app was blocked by the browser before reaching it.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS AN EDGE FUNCTION AT ALL
//
// A mail provider's API key is a secret that can send mail as your domain.
// It must never reach a browser, so the send has to happen somewhere the key
// can live — and that is the whole reason this file exists. The browser asks
// for an invitation to be sent; it never learns how, and never holds anything
// that could send one.
//
// WHY THERE IS NO SERVICE-ROLE KEY IN HERE
//
// The obvious shape for a function like this is "read the invitation with the
// service role, then check the caller". That inverts the safety: the read
// succeeds first and the check is a line of code somebody can delete.
//
// Instead the invitation is read WITH THE CALLER'S OWN TOKEN, through an
// ordinary PostgREST request. `invites_staff` is `group_rank(group_id) >= 2`,
// so an instructor, an admin or the owner gets the row and everybody else gets
// nothing — including the invited person, who has the token but is not staff.
// The authorisation is therefore the same policy that guards the table, not a
// second implementation of it that could drift.
//
// So this function holds no elevated credential of any kind. The only secret
// it needs is the mail provider's.
//
// WHAT IT DOES NOT SAY BACK
//
// The response carries no email address and no token. A caller that already
// has both learns nothing; a caller that does not must not learn either. And
// the token is never logged — a log line is a place a bearer credential
// outlives the seven days it was supposed to.
//
// WHEN THE MAIL SERVICE IS NOT CONNECTED
//
// It answers 200 with `{ sent: false, reason }` rather than failing. The
// invitation already exists and its link already works: an instructor who can
// read "the mail service is not connected, copy the link" can still teach
// their class today. An error here would look like "the invitation failed",
// which would be false.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT HAS TO BE CONNECTED, AND BY WHOM
//
// Set as Supabase secrets, never in this file and never in the repository:
//
//   RESEND_API_KEY   the provider key. `npx supabase secrets set RESEND_API_KEY=...`
//   INVITE_FROM      e.g. "מחברת מתכונים <invites@your-domain.com>". The domain
//                    must be verified with Resend first, or every message goes
//                    to spam — that is the part that takes a DNS record and a
//                    day, not this code.
//   PUBLIC_SITE_URL  where the app is served, so the link in the mail points
//                    at the real host rather than at whoever clicked.
//
// Resend is the provider this is written against because its API is one POST
// and it needs no SDK. Swapping it is this one `fetch`: the body shape is the
// only provider-specific thing in the file.

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface InviteRow {
  id: string;
  email: string | null;
  token: string;
  expires_at: string;
  status: string;
  group_id: string;
  groups: { name: string } | null;
}

/*
  CORS. The browser calls this function from the app's own origin, and a
  cross-origin call is preceded by an OPTIONS preflight that the function
  must answer — without it, every call from the app failed in the browser
  before reaching this code ("No 'Access-Control-Allow-Origin' header"), and
  no invitation email was ever sent (QA 22.09.2026). The wildcard origin is
  safe here: the request still carries the caller's own JWT, and the read
  below is decided by row-level security, not by the origin.
*/
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

/** One reply shape for everything, so no branch can leak by being different. */
function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function inviteEmail(opts: {
  groupName: string;
  link: string;
  expiresAt: string;
}): { subject: string; html: string; text: string } {
  const days = Math.max(
    0,
    Math.ceil((Date.parse(opts.expiresAt) - Date.now()) / 86_400_000),
  );
  const subject = `הזמנה לקבוצה ״${opts.groupName}״ במחברת מתכונים`;

  /*
    `dir="rtl"` on the container and not only on <html>: several mail clients
    strip the outer document and keep the body, and a Hebrew invitation that
    arrives left-to-right reads as spam.

    Inline styles, because Gmail removes <style> blocks. Tables are avoided —
    a single column needs none, and a table layout is where dark mode breaks.
  */
  const html = `<!doctype html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:24px;background:#fbfbf9;font-family:Arial,Helvetica,sans-serif;">
    <div dir="rtl" style="max-width:520px;margin:0 auto;background:#fdfbf6;border:1px solid #cdd4ce;border-radius:11px;padding:24px;color:#171a18;">
      <h1 style="margin:0 0 12px;font-size:20px;">הוזמנתם לקבוצה ״${escapeHtml(opts.groupName)}״</h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.7;">
        קיבלתם הזמנה להצטרף לקבוצה במחברת מתכונים. אחרי ההצטרפות תראו את
        הקורסים, את השיעורים ואת המתכונים שהמדריך שיתף, ותוכלו להשתתף בצ׳אט
        הקבוצה.
      </p>
      <p style="margin:0 0 20px;font-size:13px;line-height:1.7;color:#6e7a73;">
        המחברת האישית שלכם נשארת פרטית. מדריך אינו רואה את המתכונים שלכם, את
        ההערות האישיות, את הכיול ואת הניסויים — גם לא אחרי ההצטרפות.
      </p>
      <p style="margin:0 0 20px;">
        <a href="${opts.link}" style="display:inline-block;padding:12px 20px;background:#1e6b4c;color:#ffffff;border-radius:10px;text-decoration:none;font-size:15px;">
          פתיחת ההזמנה
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#6e7a73;">
        הקישור תקף ${days === 1 ? 'יום אחד' : `${days} ימים`} והוא לשימוש חד־פעמי.
        אם ההזמנה נשלחה לכתובת הזאת, רק היא תוכל להשתמש בו.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.7;color:#6e7a73;">
        לא ביקשתם את ההזמנה? אפשר להתעלם מההודעה. לא נוצר לכם חשבון ולא נעשה
        דבר.
      </p>
    </div>
  </body>
</html>`;

  // A plain-text part, because a mail with only HTML scores as spam and
  // because some clients still show this one.
  const text = [
    `הוזמנתם לקבוצה ״${opts.groupName}״ במחברת מתכונים.`,
    '',
    `לפתיחת ההזמנה: ${opts.link}`,
    '',
    `הקישור תקף ${days} ימים ולשימוש חד־פעמי.`,
    'המחברת האישית שלכם נשארת פרטית — מדריך אינו רואה את המתכונים, ההערות, הכיול והניסויים שלכם.',
    'לא ביקשתם? אפשר להתעלם מההודעה.',
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return reply({ sent: false, reason: 'method not allowed' }, 405);

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return reply({ sent: false, reason: 'not signed in' }, 401);
  }

  let inviteId: string;
  try {
    const body = (await req.json()) as { invite_id?: unknown };
    if (typeof body.invite_id !== 'string' || body.invite_id === '') {
      return reply({ sent: false, reason: 'invite_id is required' }, 400);
    }
    inviteId = body.invite_id;
  } catch {
    return reply({ sent: false, reason: 'invalid body' }, 400);
  }

  /*
    The caller's own token, passed straight through. This client has exactly
    the caller's privileges — no more — so the read below is the policy's
    decision and not ours.
  */
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } } },
  );

  const { data, error } = await supabase
    .from('group_invites')
    .select('id, email, token, expires_at, status, group_id, groups (name)')
    .eq('id', inviteId)
    .maybeSingle();

  if (error) return reply({ sent: false, reason: 'could not read the invitation' }, 500);

  /*
    No row means one of: no such invitation, or the caller is not staff of that
    group. ONE answer for both — the same rule as everywhere else in §10, and
    for the same reason.
  */
  const invite = data as InviteRow | null;
  if (!invite) return reply({ sent: false, reason: 'not found' }, 404);

  if (invite.status !== 'pending') {
    return reply({ sent: false, reason: 'ההזמנה אינה ממתינה יותר, ולכן לא נשלח מייל.' });
  }
  if (!invite.email) {
    return reply({
      sent: false,
      reason: 'ההזמנה היא קישור פתוח בלי כתובת מייל, ולכן אין לאן לשלוח.',
    });
  }

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('INVITE_FROM');
  const siteUrl = Deno.env.get('PUBLIC_SITE_URL');

  if (!apiKey || !from || !siteUrl) {
    /*
      Deliberately a 200. The invitation exists and its link works; what is
      missing is the mail service, which is a configuration fact and not a
      failure of this request. The UI shows this sentence and the link.
    */
    return reply({
      sent: false,
      reason:
        'שירות המייל אינו מחובר בפרויקט הזה. ההזמנה נוצרה — אפשר להעתיק את הקישור ולשלוח אותו בכל דרך.',
    });
  }

  const link = `${siteUrl.replace(/\/+$/, '')}/join/${invite.token}`;
  const { subject, html, text } = inviteEmail({
    groupName: invite.groups?.name ?? 'קבוצה',
    link,
    expiresAt: invite.expires_at,
  });

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [invite.email], subject, html, text }),
  });

  if (!sent.ok) {
    /*
      The provider's own text is NOT passed back. It can quote the recipient
      address, and this response is read by a browser — which already knows the
      address it typed, but the rule is that a response says nothing it does
      not have to. The status code is enough to act on.
    */
    return reply({
      sent: false,
      reason: `שליחת המייל נכשלה בצד שירות המייל (${sent.status}). ההזמנה נוצרה — אפשר להעתיק את הקישור ולשלוח אותו.`,
    });
  }

  return reply({ sent: true });
});
