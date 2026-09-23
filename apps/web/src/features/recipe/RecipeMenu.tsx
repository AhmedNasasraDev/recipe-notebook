// The recipe's ⋮ menu (spec §8.1–8.2, stage 5; fixes U-1 and U-2).
//
// ONE BUTTON, EVERY ACTION. It used to be a ⋮ at the top that scrolled the
// page 2,500px down to a "עוד פעולות" panel at the bottom (U-1), beside a
// large filled print button (U-2). Now the ⋮ opens a real menu under itself:
// edit · duplicate · share · photo · favourite · print/PDF · label · order
// sheet — and delete last, in red, behind its own line, which opens the
// page's confirmation rather than deleting.
//
// §8.2, each rule and where it is met:
//   click opens / closes            — the button
//   click outside closes            — the document listener while open
//   Escape closes, focus returns    — onKeyDown on the menu, `btnRef.focus()`
//   Tab / Enter / Space             — native to buttons and links; Tab out of
//                                     the menu closes it (onBlur leaving)
//   arrows move between items       — ArrowDown/Up/Home/End on the menu
//   screen reader                   — button aria-label "פעולות למתכון",
//                                     aria-haspopup="menu", aria-expanded;
//                                     role="menu" / "menuitem"
//   not clipped                     — positioned under the button inside the
//                                     sticky bar, z-index above the page
//   ≥44×44                          — every item is a 44px row
//   readable over a photograph      — the bar sits above the hero on its own
//                                     paper, and the menu is paper with a line
//                                     and a shadow

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MenuDotsIcon } from '../../shell/Icons.js';
import styles from './recipe.module.css';

export interface MenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  /** a link, when the action is a place */
  to?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** the one red item, kept last and behind a line (§8.1) */
  danger?: boolean;
  /** for a toggle such as the favourite */
  pressed?: boolean;
}

export interface RecipeMenuProps {
  actions: readonly MenuAction[];
  /** a one-line result shown under the menu button, e.g. "הועתק" */
  status?: string | null;
}

export function RecipeMenu({ actions, status }: RecipeMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  // Outside click closes. Registered only while open, so a closed menu costs
  // nothing and cannot swallow a click meant for the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Focus lands on the first item when the menu opens from the keyboard or
  // a click alike: the arrows have to start somewhere.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
  }, [open]);

  const items = () =>
    [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'ArrowDown':
        go(at + 1);
        break;
      case 'ArrowUp':
        go(at - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(list.length - 1);
        break;
      default:
    }
  };

  // Tab leaving the menu closes it (the next focusable thing is on the page).
  const onMenuBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
  };

  const select = (a: MenuAction) => {
    close(false);
    a.onSelect?.();
  };

  const plain = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={styles.menuBtn}
        aria-label="פעולות למתכון"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MenuDotsIcon />
      </button>
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="פעולות למתכון"
          className={styles.menuPop}
          onKeyDown={onMenuKeyDown}
          onBlur={onMenuBlur}
        >
          {plain.map((a) => (
            <MenuItem key={a.id} action={a} onPick={() => select(a)} />
          ))}
          {danger.length > 0 && <div className={styles.menuSep} role="separator" />}
          {danger.map((a) => (
            <MenuItem key={a.id} action={a} onPick={() => select(a)} />
          ))}
        </div>
      )}
      {status && (
        <p className={styles.menuStatus} role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}

function MenuItem({ action, onPick }: { action: MenuAction; onPick: () => void }) {
  const cls = action.danger ? styles.menuItemDanger : styles.menuItem;
  const inner = (
    <>
      {action.icon && (
        <span className={styles.menuIcon} aria-hidden="true">
          {action.icon}
        </span>
      )}
      <span>{action.label}</span>
    </>
  );
  if (action.to && !action.disabled) {
    return (
      <Link to={action.to} role="menuitem" className={cls} onClick={onPick} tabIndex={-1}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      className={cls}
      disabled={action.disabled}
      aria-disabled={action.disabled ? 'true' : undefined}
      {...(action.pressed !== undefined ? { 'aria-pressed': action.pressed } : {})}
      onClick={onPick}
      tabIndex={-1}
    >
      {inner}
    </button>
  );
}
