// One place that turns a failure into a sentence a baker can act on.
//
// QA 22.09.2026, findings 13 and 14: a dropped connection reached the screen
// as "יצירת המתכון נכשלה: TypeError: Failed to fetch", and a server refusal as
// PostgREST's own English. The sign-in screen already translated its own
// failures; every other surface passed the raw text through. This is the
// translation the repositories apply to every cause they wrap, so a screen
// that prints `error.message` prints Hebrew.
//
// A message the SERVER wrote in Hebrew (the RPCs raise their refusals in
// Hebrew — "הקוד אינו מתאים לשום קבוצה", "אתם כבר חברים בקבוצה הזאת") is kept
// as it is: it is already the sentence the person needs.

const HEBREW = /[\u0590-\u05FF]/;

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    return String((cause as { message: unknown }).message);
  }
  return cause === null || cause === undefined ? '' : String(cause);
}

function codeOf(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    return String((cause as { code: unknown }).code ?? '');
  }
  return '';
}

/** The sentence for a failure. Empty when there is nothing to say. */
export function describeCause(cause: unknown): string {
  const message = messageOf(cause);
  const code = codeOf(cause);
  const lower = message.toLowerCase();

  if (HEBREW.test(message)) return message;

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('err_internet') ||
    lower.includes('fetch failed')
  ) {
    return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב — מה שהוקלד נשאר על המסך.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'השרת לא ענה בזמן. נסו שוב בעוד רגע.';
  }
  if (lower.includes('jwt') || lower.includes('not authenticated') || code === 'PGRST301') {
    return 'ההתחברות פגה. יש להתחבר מחדש ואז לנסות שוב.';
  }
  if (code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'אין לחשבון הזה הרשאה לפעולה הזאת.';
  }
  if (code === '23505' || lower.includes('duplicate key')) {
    return 'רשומה כזאת כבר קיימת.';
  }
  if (code === '23503') {
    return 'הפעולה נחסמה כי רשומות אחרות תלויות ברשומה הזאת.';
  }
  if (code === 'P0001' || code === '22023') {
    return message;
  }
  if (code.startsWith('PGRST') || code.startsWith('PGRST')) {
    return `השרת לא הצליח לבצע את הבקשה (${code}). אם זה חוזר, יש לדווח לתמיכה.`;
  }
  if (lower.includes('payload too large') || lower.includes('exceeded the maximum allowed size')) {
    return 'הקובץ גדול מדי לשרת.';
  }
  if (!message) return '';
  // Unknown and English: keep it, but behind a Hebrew lead so the screen is
  // never only a stack-trace fragment.
  return `השרת החזיר שגיאה: ${message}`;
}
