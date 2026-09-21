// The invitation link: /join/:token
//
// WHY THE TOKEN IS NOT REDEEMED ON ARRIVAL
//
// Redemption is single use and it CHANGES something — it puts the account into
// somebody's group. A link that did that on page load would mean a preview in
// a chat app, a mail scanner or a mistaken tap had joined the group and burned
// the invitation. So the screen asks, and the person decides.
//
// WHY EVERY FAILURE READS THE SAME
//
// Wrong address, expired, revoked, already used, no such token: one sentence
// for all five, because the stage brief is explicit — "אין לחשוף אם כתובת
// אימייל מסוימת קיימת במערכת" — and a distinguishable error is a way to test
// it. `redeem_group_invite` returns one message for all of them (0031); this
// screen does not add detail the server deliberately withheld.
//
// The token is never shown. It is a bearer credential, and putting it in the
// page is how it ends up in a screenshot.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppData } from '../app/AppDataProvider.js';
import { BackControl } from '../components/BackLink.js';
import styles from './JoinScreen.module.css';

export function JoinScreen() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { groups: api } = useAppData();

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  const onJoin = async (): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      const groupId = await api.redeemInvite(token);
      navigate(`/group/${groupId}`, { replace: true });
    } catch (e) {
      setProblem(
        e instanceof Error
          ? e.message
          : 'ההזמנה אינה תקפה. ייתכן שפג תוקפה, שהיא בוטלה, שכבר נעשה בה שימוש, או שהיא נשלחה לכתובת אחרת.',
      );
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async (): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      await api.rejectInvite(token);
      setDeclined(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'דחיית ההזמנה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  if (declined) {
    return (
      <div className={styles.page}>
        {/* An invitation is opened from outside the app, so there is usually
            nothing behind it — `parentOf` sends this one to Home, which is
            the screen that says what the application is. */}
        <BackControl />
        <h1 className={styles.title}>ההזמנה נדחתה</h1>
        <p className={styles.lede}>
          לא הצטרפתם לקבוצה, והקישור הזה לא יעבוד יותר. אם זו הייתה טעות, אפשר
          לבקש מהמדריך לשלוח הזמנה חדשה.
        </p>
        <Link to="/groups" className={styles.secondary}>
          לכל הקבוצות
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <BackControl />
      <h1 className={styles.title}>הזמנה לקבוצה</h1>
      <p className={styles.lede}>
        קיבלתם הזמנה להצטרף לקבוצה. אחרי ההצטרפות תראו את הקורסים, את השיעורים
        ואת המתכונים שהמדריך שיתף, ותוכלו להשתתף בצ׳אט.
      </p>
      <p className={styles.privacy}>
        המחברת האישית שלכם נשארת פרטית. מדריך אינו רואה את המתכונים שלכם, את
        ההערות שלכם, את הכיול האישי ואת הניסויים — גם לא אחרי ההצטרפות.
      </p>

      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void onJoin()}
          disabled={busy}
        >
          הצטרפות לקבוצה
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void onDecline()}
          disabled={busy}
        >
          לא תודה
        </button>
      </div>
    </div>
  );
}
