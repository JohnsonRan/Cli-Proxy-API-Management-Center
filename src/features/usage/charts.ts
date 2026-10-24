import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@/hooks/motion';
import { useThemeStore } from '@/stores';

// Register only what the usage page draws so the single-file bundle stays small.
Chart.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
);

/** Accent colour of each headline metric, shared by its card, sparkline and charts. */
export const METRIC_ACCENTS = {
  requests: '#3b82f6',
  success: '#22c55e',
  tokens: '#8b5cf6',
  cost: '#f59e0b',
  cache: '#14b8a6',
  latency: '#f97316',
  ttft: '#06b6d4',
  speed: '#ec4899',
} as const;
export type MetricAccent = keyof typeof METRIC_ACCENTS;

/** Stable colour for the i-th entry of a ranked list. */
export const rankColor = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

/** Categorical series colours that read on both light and dark themes. */
export const SERIES_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#0ea5e9',
  '#a855f7',
  '#ef4444',
  '#84cc16',
  '#ec4899',
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
    success: '#10b981',
    failure: '#c65746',
    surface: '#ffffff',
  },
  dark: {
    text: '#c9c3bb',
    muted: '#8a847c',
    grid: '#3a3530',
    success: '#0fae78',
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
    success: read('--viz-success', fallback.success),
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

/** Shared axis/legend/tooltip options for cartesian charts. */
export const baseCartesianOptions = (theme: ChartTheme, stacked: boolean) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: chartAnimation(),
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: { color: theme.text, boxWidth: 10, boxHeight: 10, usePointStyle: true },
    },
    tooltip: { mode: 'index' as const, intersect: false },
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
      ticks: { color: theme.muted, maxTicksLimit: 6 },
      grid: { color: theme.grid },
      border: { display: false },
    },
  },
});
