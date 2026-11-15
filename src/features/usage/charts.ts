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

/**
 * Accent of each headline metric, shared by its dot, sparkline and charts. Every colour is a
 * Claude Console (platform.claude.com) palette step; related metrics share a hue family:
 * tokens and generation speed are violet, latency and time to first token are magenta.
 * Status keeps green (success), red (failed) and yellow (pending, still running) exclusive.
 */
export const METRIC_ACCENTS = {
  requests: '#2a78d6', // blue-450
  success: '#0ca30c', // green-400, Console status good
  tokens: '#7161e0', // violet-450
  cost: '#eb6834', // orange-350
  cache: '#1baf7a', // aqua-350
  latency: '#d55181', // magenta-400
  ttft: '#e87ba4', // magenta-300
  speed: '#a096eb', // violet-300
  failed: '#d03b3b', // red-450, Console status critical
  pending: '#eda100', // yellow categorical
} as const;
export type MetricAccent = keyof typeof METRIC_ACCENTS;

/** Stable colour for the i-th entry of a ranked list. */
export const rankColor = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

/** Claude Console categorical chart colours, in Console order (violet at the tokens step). */
export const SERIES_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#7161e0',
  '#e34948',
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
    failure: METRIC_ACCENTS.failed,
    surface: '#ffffff',
  },
  dark: {
    text: '#c9c3bb',
    muted: '#8a847c',
    grid: '#3a3530',
    success: METRIC_ACCENTS.success,
    failure: METRIC_ACCENTS.failed,
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
