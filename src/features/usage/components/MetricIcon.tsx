import type { MetricAccent } from '../charts';

export type MetricIconName = MetricAccent | 'failed' | 'substituted';

// Lucide-style glyphs (24px grid) for the headline metrics.
const PATHS: Record<MetricIconName, string[]> = {
  requests: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  success: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4 12 14.01l-3-3'],
  tokens: ['M12 2 2 7l10 5 10-5-10-5Z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
  cost: ['M12 1v22', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
  cache: [
    'M19 5 5 19',
    'M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    'M17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  ],
  latency: ['M10 2h4', 'M12 14l3-3', 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  ttft: ['M13 2 3 14h9l-1 8 10-12h-9l1-8Z'],
  // Lucide "gauge".
  speed: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'],
  failed: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'm15 9-6 6', 'm9 9 6 6'],
  substituted: ['m8 3-4 4 4 4', 'M4 7h16', 'm16 21 4-4-4-4', 'M20 17H4'],
};

export function MetricIcon({ name }: { name: MetricIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
