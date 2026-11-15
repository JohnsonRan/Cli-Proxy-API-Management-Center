import { useEffect, useState, type HTMLAttributes } from 'react';
import { prefersReducedMotion, useCountUp, useRevealGroup } from '@/hooks/motion';

/**
 * Cascades its `[data-reveal]` descendants in when it mounts. Mount it once the content is
 * loaded (or key it by tab): children that appear later are not animated.
 */
export function RevealGroup(props: HTMLAttributes<HTMLDivElement>) {
  const ref = useRevealGroup<HTMLDivElement>();
  return <div ref={ref} {...props} />;
}

// useCountUp rounds to integers, so count in hundredths to keep costs and rates smooth.
const SCALE = 100;

/** Rolls a number up from zero on mount and to each new value after a refresh. */
export function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
  const [mounted, setMounted] = useState(() => prefersReducedMotion());
  useEffect(() => setMounted(true), []);
  const target = Number.isFinite(value) ? Math.round(value * SCALE) : 0;
  const shown = useCountUp(mounted ? target : 0);
  return <>{format(shown / SCALE)}</>;
}
