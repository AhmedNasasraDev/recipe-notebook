// Profiles and measurement preferences — ported from measure.js:267.
// Unchanged behaviour: a profile sets defaults and initial disclosure only, it
// never locks a feature (spec §3). `defaultPrefs` now also seeds an empty
// calibration list in the new shape.

import type { MeasurementPrefs } from './types.js';
import { TOOL_DEFAULTS } from './units.js';

export interface ProfileDef {
  id: 'home' | 'pro' | 'study';
  he: string;
  desc: string;
  units: string[];
  pro: boolean;
}

export const PROFILES: readonly ProfileDef[] = [
  {
    id: 'home',
    he: 'ביתי',
    desc: 'מדידות ביתיות, בלי נתוני ייצור ותמחור',
    units: ['g', 'cup', 'tbsp', 'tsp', 'unit'],
    pro: false,
  },
  {
    id: 'pro',
    he: 'מקצועי',
    desc: 'גרמים, תשואה, פחת, עלויות ותמחור',
    units: ['g', 'kg', 'ml', 'l', 'unit'],
    pro: true,
  },
  {
    id: 'study',
    he: 'לימוד',
    desc: 'מצב לימוד פתוח, קבוצות וקורסים בקדמת הבמה',
    units: ['g', 'ml', 'cup', 'unit'],
    pro: true,
  },
];

export const UNIT_GROUPS: readonly { id: string; he: string; ids: string[] }[] = [
  { id: 'weight', he: 'משקל', ids: ['mg', 'g', 'kg', 'oz'] },
  { id: 'volume', he: 'נפח', ids: ['ml', 'l', 'floz'] },
  { id: 'home', he: 'מדידות ביתיות', ids: ['cup', 'tbsp', 'tsp'] },
  { id: 'count', he: 'יחידות', ids: ['unit', 'egg', 'fruit', 'slice'] },
  { id: 'bar', he: 'בר וקפה', ids: ['shot'] },
];

export function defaultPrefs(
  profileId: ProfileDef['id'] = 'pro',
): MeasurementPrefs {
  const p = PROFILES.find((x) => x.id === profileId) ?? PROFILES[1]!;
  return {
    profile: p.id,
    units: [...p.units],
    tools: { ...TOOL_DEFAULTS },
    calib: [],
    pro: p.pro,
    done: false,
    touchedUnits: false,
  };
}

/** Preferred display unit inside a family. Ported from measure.js:288. */
export function preferredUnit(
  prefs: MeasurementPrefs | undefined,
  group: 'weight' | 'volume' | 'count',
): string {
  const list = prefs?.units ?? [];
  const found = list.find((id) => {
    const g = UNIT_GROUPS.find((x) => x.ids.includes(id));
    if (!g) return false;
    return (
      (group === 'weight' && g.id === 'weight') ||
      (group === 'volume' && (g.id === 'volume' || g.id === 'home' || g.id === 'bar')) ||
      (group === 'count' && g.id === 'count')
    );
  });
  if (found) return found;
  return group === 'weight' ? 'g' : group === 'volume' ? 'ml' : 'unit';
}
