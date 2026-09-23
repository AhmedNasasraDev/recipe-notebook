// Pans and equipment — spec §7.
//
// WHY THIS IS AN ENGINE CHANGE, AND WHY IT IS A PORT RATHER THAN A DESIGN
//
// The standing rule is not to touch `packages/engine/src` to suit new UI. This
// is the documented exception the rule allows: a primitive that the spec
// specifies, that the prototype already implements, and that the React app
// cannot have without it. `types.ts` has carried `Pan` since stage 1 with the
// comment "panFactor still lives in the prototype" — this file is that gap
// closed, not a new idea. The handoff says of the prototype's calculation
// layer: "אין לשכתב את המנוע… להעביר אותם כמעט as-is", so the arithmetic below
// is `measure.js#panArea/panFactor/panLabel` carried over, not re-derived.
//
// THE RULE (§7), unchanged from the prototype:
//   both heights known → ratio of VOLUME:  (area_to × h_to) / (area_from × h_from)
//   otherwise          → ratio of AREA:    area_to / area_from
//
// And the one that matters for honesty: a pan whose dimensions were not filled
// in has NO area, so there is NO factor. `panArea` returns null and
// `panFactor` returns null, exactly as a missing density does. Nothing here
// falls back to 1 — a factor of 1 is a real answer meaning "the same size",
// and it must never stand in for "we do not know".

import type { Pan } from './types.js';

export interface PanKindDef {
  id: NonNullable<Pan['kind']>;
  he: string;
  /** which geometry fields this kind asks for */
  fields: ReadonlyArray<'diameter' | 'width' | 'length' | 'height' | 'gn' | 'cavities'>;
}

/** §7 PAN_KINDS, in the prototype's order. */
export const PAN_KINDS: readonly PanKindDef[] = [
  { id: 'round', he: 'תבנית עגולה', fields: ['diameter', 'height'] },
  { id: 'rect', he: 'תבנית מלבנית', fields: ['width', 'length', 'height'] },
  { id: 'gn', he: 'תבנית GN', fields: ['gn'] },
  { id: 'loaf', he: 'תבנית אינגליש קייק', fields: ['length', 'width', 'height'] },
  { id: 'muffin', he: 'תבנית מאפינס', fields: ['cavities'] },
  { id: 'none', he: 'בלי תבנית', fields: [] },
];

/** Gastronorm outside dimensions in centimetres, from the prototype. */
export const GN: Record<string, { w: number; l: number }> = {
  '1/1': { w: 32.5, l: 53 },
  '1/2': { w: 32.5, l: 26.5 },
  '1/3': { w: 32.5, l: 17.6 },
  '2/3': { w: 35.4, l: 32.5 },
  '1/6': { w: 17.6, l: 16.2 },
};

export const GN_SIZES: readonly string[] = ['1/1', '2/3', '1/2', '1/3', '1/6'];

/** A positive finite number, or null. Blank, 0 and rubbish are all "unknown". */
function dim(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The pan's base area in cm², or null when it cannot be established.
 *
 * `muffin` is deliberately the cavity COUNT rather than an area: the prototype
 * treats 12 cavities → 24 cavities as a factor of 2, which is what a baker
 * means by it, and a cavity's own area is not asked for anywhere.
 */
export function panArea(p: Pan | null | undefined): number | null {
  if (!p || !p.kind || p.kind === 'none') return null;
  if (p.kind === 'round') {
    const d = dim(p.diameter);
    return d === null ? null : Math.PI * (d / 2) * (d / 2);
  }
  if (p.kind === 'rect' || p.kind === 'loaf') {
    const w = dim(p.width);
    const l = dim(p.length);
    return w === null || l === null ? null : w * l;
  }
  if (p.kind === 'gn') {
    const g = p.gn ? GN[String(p.gn)] : undefined;
    return g ? g.w * g.l : null;
  }
  if (p.kind === 'muffin') return dim(p.cavities);
  return null;
}

export interface PanComparison {
  /** how much bigger the target pan is; 1 means the same size */
  factor: number;
  /** true when both heights were known and the ratio is of volume */
  byVolume: boolean;
}

/**
 * §7 panFactor. null when either pan's area is unknown — never a fallback.
 *
 * Two pans of the same kind with only one height filled in fall back to the
 * AREA ratio, which is the prototype's behaviour and the honest one: a height
 * we do not have cannot enter a volume.
 */
export function panFactor(
  from: Pan | null | undefined,
  to: Pan | null | undefined,
): PanComparison | null {
  const a = panArea(from);
  const b = panArea(to);
  if (a === null || b === null) return null;
  const ha = dim(from?.height);
  const hb = dim(to?.height);
  const byVolume = ha !== null && hb !== null;
  const factor = byVolume ? (b * hb!) / (a * ha!) : b / a;
  return { factor, byVolume };
}

/** §7's threshold: below this, adapting is noise and no suggestion is made. */
export const PAN_SUGGEST_THRESHOLD = 0.02;

export function panWorthAdapting(c: PanComparison | null): boolean {
  if (c === null) return false;
  // The epsilon is not decoration. §7 says a suggestion appears only ABOVE 2%,
  // and in binary `1.02 - 1` is 0.020000000000000018 — so the plain comparison
  // offers to rescale a pan that is exactly 2% off, which the threshold exists
  // to stop. The tolerance is far below any real pan measurement.
  return Math.abs(c.factor - 1) > PAN_SUGGEST_THRESHOLD + 1e-9;
}

/** A short human label, e.g. `Ø20×7 ס"מ`. Empty when there is nothing to say. */
export function panLabel(p: Pan | null | undefined): string {
  if (!p || !p.kind || p.kind === 'none') return '';
  const h = dim(p.height);
  if (p.kind === 'round') {
    const d = dim(p.diameter);
    return d === null ? '' : `Ø${d}${h !== null ? `×${h}` : ''} ס"מ`;
  }
  if (p.kind === 'rect' || p.kind === 'loaf') {
    const w = dim(p.width);
    const l = dim(p.length);
    return w === null || l === null ? '' : `${w}×${l}${h !== null ? `×${h}` : ''} ס"מ`;
  }
  if (p.kind === 'gn') return p.gn ? `GN ${p.gn}` : '';
  if (p.kind === 'muffin') {
    const c = dim(p.cavities);
    return c === null ? '' : `${c} שקעי מאפינס`;
  }
  return '';
}

/** The kind's Hebrew name, for a screen that has a kind but no dimensions yet. */
export function panKindLabel(kind: Pan['kind'] | null | undefined): string {
  return PAN_KINDS.find((k) => k.id === kind)?.he ?? '';
}

/** Is there anything in this pan worth storing? */
export function panIsEmpty(p: Pan | null | undefined): boolean {
  return !p || !p.kind || p.kind === 'none' ? true : panArea(p) === null && !dim(p.height);
}
