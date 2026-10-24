import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@/hooks/motion';
import { useThemeStore } from '@/stores';
import { formatCompact } from './format';

// Register only what the usage page draws so the single-file bundle stays small. The trend
// chart mixes a dashed line into bar charts, so the generic <Chart> needs both controllers.
Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip
);

/** Low-saturation earthy accent of each headline metric, shared by its dot, sparkline and charts. */
export const METRIC_ACCENTS = {
  requests: '#5e7d9a',
  success: '#6c8a56',
  tokens: '#8a6b8c',
  cost: '#c96846',
  cache: '#598a7e',
  latency: '#ab8039',
  ttft: '#967d5a',
  speed: '#b36b64',
} as const;
export type MetricAccent = keyof typeof METRIC_ACCENTS;

/** Stable colour for the i-th entry of a ranked list. */
export const rankColor = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

/** Earthy categorical series colours that read on both light and dark themes. */
export const SERIES_COLORS = [
  '#c96846',
  '#5e7d9a',
  '#6c8a56',
  '#ab8039',
  '#8a6b8c',
  '#598a7e',
  '#b36b64',
  '#967d5a',
];

export interface ChartTheme {
  text: string;
  muted: string;
  grid: string;
  success: string;
  failure: string;
  surface: string;
}

const FALLBACK: Record<'light' | 'dark', ChartTheme> = {
  light: {
    text: '#6d6760',
    muted: '#9a948c',
    grid: '#e3e1db',
    success: METRIC_ACCENTS.success,
    failure: '#c65746',
    surface: '#ffffff',
  },
  dark: {
    text: '#c9c3bb',
    muted: '#8a847c',
    grid: '#3a3530',
    success: METRIC_ACCENTS.success,
    failure: '#c65746',
    surface: '#1f1c19',
  },
};

const readTheme = (fallback: ChartTheme): ChartTheme => {
  if (typeof document === 'undefined') return fallback;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, value: string) => style.getPropertyValue(name).trim() || value;
  return {
    text: read('--text-secondary', fallback.text),
    muted: read('--text-tertiary', fallback.muted),
    grid: read('--border-color', fallback.grid),
    // The usage palette owns success; the global --viz-success emerald clashes with it.
    success: fallback.success,
    failure: read('--viz-failure', fallback.failure),
    surface: read('--bg-primary', fallback.surface),
  };
};

/**
 * Theme colours read from CSS variables. Read after paint so the new data-theme attribute
 * has been applied when the user switches themes.
 */
export function useChartTheme(): ChartTheme {
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const [colors, setColors] = useState<ChartTheme>(() => readTheme(FALLBACK[resolvedTheme]));
  useEffect(() => {
    const frame = requestAnimationFrame(() => setColors(readTheme(FALLBACK[resolvedTheme])));
    return () => cancelAnimationFrame(frame);
  }, [theme, resolvedTheme]);
  return colors;
}

/**
 * Chart grow-in and refresh transition, timed like the counting card values; off when the user
 * prefers reduced motion.
 */
export const chartAnimation = () =>
  prefersReducedMotion() ? (false as const) : { duration: 900, easing: 'easeOutQuart' as const };

/**
 * Shared axis/legend/tooltip options for cartesian charts. `format` renders the y-axis ticks
 * and tooltip values, compact (1.2K, 3.4M) by default.
 */
export const baseCartesianOptions = (
  theme: ChartTheme,
  stacked: boolean,
  format: (value: number) => string = formatCompact
) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: chartAnimation(),
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: { color: theme.text, boxWidth: 10, boxHeight: 10, usePointStyle: true },
    },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      callbacks: {
        label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) => {
          const value = format(ctx.parsed.y ?? 0);
          return ctx.dataset.label ? `${ctx.dataset.label}: ${value}` : value;
        },
      },
    },
  },
  scales: {
    x: {
      stacked,
      ticks: { color: theme.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
      grid: { display: false },
      border: { color: theme.grid },
    },
    y: {
      stacked,
      beginAtZero: true,
      ticks: {
        color: theme.muted,
        maxTicksLimit: 6,
        // Counts are whole numbers; without this a small range ticks 0.2, 0.4… shown as 0, 0, 1.
        ...(format === formatCompact ? { precision: 0 } : {}),
        callback: (value: number | string) => format(Number(value)),
      },
      grid: { color: theme.grid },
      border: { display: false },
    },
  },
});
