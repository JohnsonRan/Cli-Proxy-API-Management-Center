import styles from '../UsagePage.module.scss';

/** Minimal area sparkline; scales to its container and ignores empty series. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 100;
  const height = 32;
  const max = Math.max(0, ...values);
  if (values.length < 2 || max <= 0) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line
          x1="0"
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke={color}
          strokeOpacity="0.35"
        />
      </svg>
    );
  }
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - 2 - (v / max) * (height - 6)] as const);
  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  return (
    <svg
      className={styles.sparkReveal}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={color} fillOpacity="0.14" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
