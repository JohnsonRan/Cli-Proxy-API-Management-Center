import { exactCount, formatCompact, formatPercent } from '../format';
import styles from '../UsagePage.module.scss';

/** Panel title with a one-line description, the main hierarchy cue of each section. */
export function PanelHeading({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className={styles.panelHeading}>
      <h2 className={styles.panelTitle}>{title}</h2>
      {desc && <p className={styles.panelDesc}>{desc}</p>}
    </div>
  );
}

/** Compact count (1.2M) with the exact number on hover. */
export function Compact({ value }: { value: number }) {
  return <span title={exactCount(value)}>{formatCompact(value)}</span>;
}

/** Success rate coloured by health: >=99% good, >=90% warning, below that bad. */
export function Rate({ value }: { value: number | null }) {
  const tone =
    value === null
      ? styles.muted
      : value >= 99
        ? styles.rateGood
        : value >= 90
          ? styles.rateWarn
          : styles.rateBad;
  return <span className={tone}>{formatPercent(value)}</span>;
}
