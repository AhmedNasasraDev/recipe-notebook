import type { Provenance, Source } from '@recipe-notebook/engine';
import styles from './SourceBadge.module.css';

/**
 * Renders a conversion's provenance exactly as the engine reported it.
 *
 * The badge takes its label and colour from `provenance`, which the engine
 * computed as the WEAKEST link of the conversion chain. A caller cannot choose
 * a friendlier label, which is precisely the defect B3 was.
 */
export function SourceBadge({ provenance }: { provenance: Provenance }) {
  const cls: Record<Source, string> = {
    exact: styles.exact!,
    personal: styles.personal!,
    recipe: styles.recipe!,
    system: styles.system!,
    estimate: styles.estimate!,
    unavailable: styles.unavailable!,
  };

  return (
    <span className={`${styles.badge} ${cls[provenance.source]}`} title={provenance.why}>
      {provenance.label}
      {provenance.needsReview && (
        <span className={styles.review} aria-label="נתון שממתין לאימות מקצועי">
          · לאימות
        </span>
      )}
    </span>
  );
}
