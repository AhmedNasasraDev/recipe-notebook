/*
  THE WAY BACK, DRAWN ONCE.

  §4 of the handoff is explicit and it is a correction, not a preference: on an
  inner screen the back control sits at the RIGHT-HAND end of its row, carries
  a chevron that points RIGHT — because this application is Hebrew and the page
  you came from is to the right — and looks like a control: a light sage pill,
  not a line of blue text.

  Every screen used to draw its own. Eleven of them had "← המחברת" or "← עוד"
  in the markup: a Latin arrow, pointing at the page you are LEAVING, at
  whatever height that screen's stylesheet happened to give it. This component
  is the one answer, and the one place to change it.

  Root screens — בית, מחברת, קבוצות, עוד — do not use it at all. There is
  nothing above them to go back to, and the handoff's notebook mockup showing a
  back button there is one of the mistakes it asks us not to copy.
*/

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BackIcon } from '../shell/Icons.js';
import styles from './BackLink.module.css';

interface Common {
  children: ReactNode;
  /**
   * `paper` is for a control that sits ON a photograph, where the sage tint
   * cannot be trusted to stay legible — the recipe hero is the one place.
   */
  tone?: 'sage' | 'paper';
  className?: string;
}

const cls = (tone: 'sage' | 'paper' | undefined, extra: string | undefined) =>
  [tone === 'paper' ? styles.paper : styles.sage, extra].filter(Boolean).join(' ');

export function BackLink({
  to,
  children,
  tone,
  className,
  ...rest
}: Common & { to: string; 'aria-label'?: string }) {
  return (
    <Link to={to} className={cls(tone, className)} {...rest}>
      <BackIcon />
      <span className={styles.label}>{children}</span>
    </Link>
  );
}

/**
 * The same control where going back is an ACTION rather than an address —
 * cancelling an edit, leaving a focused mode. A button, because it is one.
 */
export function BackButton({
  onClick,
  children,
  tone,
  className,
  ...rest
}: Common & { onClick(): void; 'aria-label'?: string }) {
  return (
    <button type="button" onClick={onClick} className={cls(tone, className)} {...rest}>
      <BackIcon />
      <span className={styles.label}>{children}</span>
    </button>
  );
}
