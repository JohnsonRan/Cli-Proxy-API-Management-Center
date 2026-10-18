/**
 * Timeline lanes for the accounts an upstream proxy shares. Pure, like the model it
 * feeds: the caller passes the loaded results and a label resolver.
 */

import {
  flattenUpstreamAccounts,
  type UpstreamQuotaCredential,
  type UpstreamQuotaWindow,
} from '@/features/providers/upstreamQuota';
import { pickLaneWindow, type TimelineLane } from './quotaTimelineModel';

/** Periods of the core's window ids, for a summary that omits `period_seconds`. */
const KNOWN_PERIOD_HOURS: Record<string, number> = {
  five_hour: 5,
  code_review_five_hour: 5,
  weekly: 24 * 7,
  seven_day: 24 * 7,
  seven_day_opus: 24 * 7,
  seven_day_sonnet: 24 * 7,
  seven_day_oauth_apps: 24 * 7,
  seven_day_cowork: 24 * 7,
  seven_day_fable: 24 * 7,
  code_review_weekly: 24 * 7,
};

/** Account-wide windows; model-scoped ones with the same period must not anchor the lane. */
const SESSION_IDS = ['five_hour'];
const WEEKLY_IDS = ['weekly', 'seven_day'];

export interface UpstreamTimelineSource {
  /** Unique per provider key, so lanes of two keys never collide. */
  key: string;
  credentials: UpstreamQuotaCredential[];
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const laneFor = (
  key: string,
  credential: UpstreamQuotaCredential,
  maxPeriodHours: number | undefined,
  labelFor: (window: UpstreamQuotaWindow) => string
): TimelineLane | null => {
  const windows = credential.windows
    .map((window) => ({
      window,
      id: window.id,
      usedPercent: window.usedPercent,
      resetAtMs: window.resetAt ? Date.parse(window.resetAt) : NaN,
      periodHours:
        window.periodSeconds && window.periodSeconds > 0
          ? window.periodSeconds / 3600
          : (KNOWN_PERIOD_HOURS[window.id] ?? null),
    }))
    .filter((window) => Number.isFinite(window.resetAtMs));

  const preferredIds =
    maxPeriodHours !== undefined && maxPeriodHours <= 5 ? SESSION_IDS : WEEKLY_IDS;
  const chosen =
    windows.find(
      (window) =>
        preferredIds.includes(window.id) &&
        window.periodHours !== null &&
        (maxPeriodHours === undefined || window.periodHours <= maxPeriodHours)
    ) ?? pickLaneWindow(windows, maxPeriodHours);
  if (!chosen) return null;

  return {
    name: key,
    displayName: credential.name,
    provider: credential.provider,
    anchorMs: chosen.resetAtMs,
    periodHours: chosen.periodHours,
    remaining: chosen.usedPercent === null ? null : clampPercent(100 - chosen.usedPercent),
    limits: windows
      .filter((window) => window.usedPercent !== null)
      .map((window) => ({
        label: labelFor(window.window),
        remaining: clampPercent(100 - (window.usedPercent as number)),
      })),
    resetCredits: [],
  };
};

/**
 * One lane per shared account that reports a reset instant. Relay entries are proxies,
 * not accounts, so only the accounts behind them get a lane.
 */
export function buildUpstreamTimelineLanes(
  sources: UpstreamTimelineSource[],
  labelFor: (window: UpstreamQuotaWindow) => string,
  maxPeriodHours?: number
): TimelineLane[] {
  return sources.flatMap((source) =>
    flattenUpstreamAccounts(source.credentials).flatMap(({ credential, path }) => {
      if (credential.status !== 'ok') return [];
      const lane = laneFor(`upstream:${source.key}${path}`, credential, maxPeriodHours, labelFor);
      return lane ? [lane] : [];
    })
  );
}
