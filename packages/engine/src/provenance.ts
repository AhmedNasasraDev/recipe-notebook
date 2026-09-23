// Provenance — the fix for B3.
//
// The legacy code decided the badge from the LAST conversion step only. Because
// the recipe screen handed the drawer an already-converted gram figure, a cup
// measurement resolved through an estimate table was then converted g→g and
// proudly labelled "המרה מדויקת".
//
// Here every step is recorded, and the reported confidence is the WEAKEST link
// in the chain. An estimate can never come out the other end as exact.

import type { Confidence, Provenance, ProvenanceStep, Source } from './types.js';

/** Lower rank = weaker. Used to pick the weakest link. */
const RANK: Record<Source, number> = {
  unavailable: 0,
  estimate: 1,
  system: 2,
  recipe: 3,
  personal: 4,
  exact: 5,
};

export const SOURCE_META: Record<
  Source,
  { label: string; color: string; confidence: Confidence; exact: boolean }
> = {
  exact: {
    label: 'המרה מדויקת',
    color: '#1E6B4C',
    confidence: 'exact',
    exact: true,
  },
  personal: {
    label: 'כיול אישי',
    color: '#1E6B4C',
    confidence: 'exact',
    exact: true,
  },
  recipe: {
    label: 'נתון מהמתכון',
    color: '#1E6B4C',
    confidence: 'measured',
    exact: true,
  },
  system: {
    label: 'נתון מערכת',
    color: '#A56A0E',
    confidence: 'measured',
    exact: false,
  },
  estimate: {
    label: 'הערכה גסה',
    color: '#9E362C',
    confidence: 'estimated',
    exact: false,
  },
  unavailable: {
    label: 'אין נתון אמין',
    color: '#9E362C',
    confidence: 'none',
    exact: false,
  },
};

export function weakest(sources: Source[]): Source {
  if (sources.length === 0) return 'exact';
  return sources.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
}

export function buildProvenance(
  chain: ProvenanceStep[],
  opts: { why?: string; toolNote?: string; needsReview?: boolean } = {},
): Provenance {
  const source = weakest(chain.map((s) => s.source));
  const meta = SOURCE_META[source];
  const needsReview = opts.needsReview ?? false;
  const why =
    opts.why ??
    chain
      .map((s) => s.note)
      .filter(Boolean)
      .join(' ');
  return {
    source,
    confidence: meta.confidence,
    // A chain is exact only if EVERY step is exact-grade. `weakest` already
    // guarantees this, but state it explicitly so the invariant is readable.
    exact: meta.exact && chain.every((s) => SOURCE_META[s.source].exact),
    label: meta.label,
    color: meta.color,
    why,
    chain,
    toolNote: opts.toolNote,
    needsReview,
  };
}

export function unavailableProvenance(why: string): Provenance {
  return buildProvenance(
    [{ from: '—', to: '—', source: 'unavailable', note: why }],
    { why },
  );
}

/** Copy of a provenance with extra steps appended — used when chaining. */
export function extendProvenance(
  base: Provenance,
  steps: ProvenanceStep[],
  opts: { why?: string; toolNote?: string } = {},
): Provenance {
  return buildProvenance([...base.chain, ...steps], {
    why: opts.why ?? base.why,
    toolNote: opts.toolNote ?? base.toolNote,
    needsReview: base.needsReview,
  });
}
