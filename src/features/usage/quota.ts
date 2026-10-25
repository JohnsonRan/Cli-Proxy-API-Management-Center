/**
 * Credential quota helpers for the usage overview table.
 *
 * Pure and React-free: derives tightest-window summaries from the quota
 * feature's `buildTimelineLane` and `resetSchedule` helpers without duplicating
 * provider state parsers.
 */

import { isRuntimeOnlyAuthFile } from '@/features/authFiles/constants';
import {
  QUOTA_PROGRESS_HIGH_THRESHOLD,
  QUOTA_PROGRESS_MEDIUM_THRESHOLD,
} from '@/features/quota/components/QuotaMeter';
import { resolveQuotaProviderType, type QuotaFileEntry } from '@/features/quota/logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import type { QuotaProviderType, QuotaStore } from '@/features/quota/providers/types';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import { collectQuotaRowInstants, nextRecoveryMs } from '@/features/quota/resetSchedule';
import type { AuthFileItem } from '@/types';
import { isDisabledAuthFile } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { normalizeRecentRequestAuthIndex } from '@/utils/recentRequests';
import { HOUR_MS } from '@/utils/time/durations';

export type QuotaTone = 'high' | 'medium' | 'low';

export interface CredentialQuotaSummary {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Tightest window remaining percentage (0..100), or null when unavailable. */
  remaining: number | null;
  /** Label of the tightest window when reported by `buildTimelineLane`, else empty. */
  windowLabel: string;
  /** Upcoming reset instant (> nowMs) in epoch ms for the tightest window, else null. */
  resetAtMs: number | null;
  /** Severity bucket matching QuotaMeter thresholds (>=70 high, >=30 medium, <30 low). */
  tone: QuotaTone | null;
  /** True when the tightest window is in the low (<30%) warning zone. */
  low: boolean;
  /** True when the reset is under an hour away and capacity is below the healthy threshold. */
  resetUrgent: boolean;
}

const EMPTY_SUMMARY: Omit<CredentialQuotaSummary, 'status'> = {
  remaining: null,
  windowLabel: '',
  resetAtMs: null,
  tone: null,
  low: false,
  resetUrgent: false,
};

/** Resolve an auth file to a quota-capable entry, skipping disabled and runtime-only items. */
export function resolveUsageQuotaEntry(file: AuthFileItem): QuotaFileEntry | null {
  if (isRuntimeOnlyAuthFile(file) || isDisabledAuthFile(file)) return null;
  const type = resolveQuotaProviderType(file);
  return type ? { file, type } : null;
}

/** Map normalized `auth_index` strings to their quota-capable `QuotaFileEntry`. */
export function indexQuotaEntriesByAuthIndex(
  files: readonly AuthFileItem[]
): Map<string, QuotaFileEntry> {
  const map = new Map<string, QuotaFileEntry>();
  for (const file of files) {
    const authIndex = normalizeRecentRequestAuthIndex(file['auth_index'] ?? file.authIndex);
    if (!authIndex || map.has(authIndex)) continue;
    const entry = resolveUsageQuotaEntry(file);
    if (entry) map.set(authIndex, entry);
  }
  return map;
}

/**
 * Map normalized `auth_index` strings to a display name: the account email, or the file name when
 * several files share that email (one account signed in to Codex and Claude, or to two workspaces).
 */
export function credentialNamesByAuthIndex(files: readonly AuthFileItem[]): Map<string, string> {
  const emailCounts = new Map<string, number>();
  for (const file of files) {
    const email = file.email?.trim().toLowerCase();
    if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }
  const names = new Map<string, string>();
  for (const file of files) {
    const authIndex = normalizeRecentRequestAuthIndex(file['auth_index'] ?? file.authIndex);
    if (!authIndex) continue;
    const email = file.email?.trim();
    const unique = email && emailCounts.get(email.toLowerCase()) === 1;
    names.set(authIndex, (unique ? email : file.name) || email || '');
  }
  return names;
}

/** Collect deduplicated batch-load targets for the credentials shown in the table. */
export function collectCredentialQuotaTargets(
  credentials: readonly { authIndex: string }[],
  resolveEntry?: (authIndex: string) => QuotaFileEntry | null
): QuotaFileEntry[] {
  if (!resolveEntry) return [];
  const seen = new Set<string>();
  const targets: QuotaFileEntry[] = [];
  for (const item of credentials) {
    const entry = resolveEntry(item.authIndex);
    if (!entry) continue;
    const cacheKey = getQuotaCacheKey(entry.file);
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);
    targets.push(entry);
  }
  return targets;
}

/** Read a credential's cached quota state from the global quota store snapshot. */
export function readCachedQuota(
  storeState: QuotaStore,
  entry: QuotaFileEntry
): QuotaCardState | undefined {
  const adapter = QUOTA_ADAPTERS[entry.type];
  if (!adapter) return undefined;
  return adapter.storeSelector(storeState)[getQuotaCacheKey(entry.file)];
}

/**
 * Align per-window reset instants with `lane.limits` when `buildTimelineLane`
 * kept every anchored window 1-to-1.
 */
function alignLimitInstants(
  provider: QuotaProviderType,
  quota: QuotaCardState,
  limitCount: number
): readonly { atMs: number }[] | null {
  if (limitCount === 0 || provider === 'devin') return null;

  const windowInstants = collectQuotaRowInstants(provider, quota).filter(
    (item) => item.kind === 'window'
  );

  if (provider === 'claude') {
    const anchoredWindows = (
      (quota as { windows?: { resetAtMs?: unknown }[] }).windows ?? []
    ).filter((w) => typeof w.resetAtMs === 'number' && Number.isFinite(w.resetAtMs)).length;
    return anchoredWindows === limitCount && windowInstants.length >= anchoredWindows
      ? windowInstants.slice(0, anchoredWindows)
      : null;
  }

  return windowInstants.length === limitCount ? windowInstants : null;
}

/** Summarize a credential's tightest quota window and its upcoming reset instant. */
export function summarizeCredentialQuota(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined,
  nowMs: number,
  name = ''
): CredentialQuotaSummary {
  if (!quota || quota.status === 'idle') {
    return { status: 'idle', ...EMPTY_SUMMARY };
  }
  if (quota.status === 'loading') {
    return { status: 'loading', ...EMPTY_SUMMARY };
  }
  if (quota.status === 'error') {
    return { status: 'error', ...EMPTY_SUMMARY };
  }

  const futureMs = (ms: number | null | undefined): number | null =>
    typeof ms === 'number' && Number.isFinite(ms) && ms > nowMs ? ms : null;

  const baseInput = { name, displayName: name, provider, quota };
  const fullLane = buildTimelineLane(baseInput);

  let remaining: number | null = null;
  let windowLabel = '';
  let resetAtMs: number | null = null;

  if (fullLane.limits.length > 0) {
    const aligned = alignLimitInstants(provider, quota, fullLane.limits.length);
    let bestIndex = 0;

    for (let i = 1; i < fullLane.limits.length; i += 1) {
      const candidate = fullLane.limits[i];
      const currentBest = fullLane.limits[bestIndex];
      if (candidate.remaining < currentBest.remaining) {
        bestIndex = i;
      } else if (candidate.remaining === currentBest.remaining && aligned) {
        const candidateReset = futureMs(aligned[i].atMs);
        const bestReset = futureMs(aligned[bestIndex].atMs);
        if (candidateReset !== null && (bestReset === null || candidateReset < bestReset)) {
          bestIndex = i;
        }
      }
    }

    const bestLimit = fullLane.limits[bestIndex];
    remaining = bestLimit.remaining;
    windowLabel = bestLimit.label;

    if (aligned) {
      resetAtMs = futureMs(aligned[bestIndex].atMs);
    } else {
      const candidateLanes = [
        buildTimelineLane({ ...baseInput, maxPeriodHours: 5 }),
        buildTimelineLane({ ...baseInput, maxPeriodHours: 24 }),
        fullLane,
      ];
      for (const lane of candidateLanes) {
        const anchor = futureMs(lane.anchorMs);
        if (lane.remaining === remaining && anchor !== null) {
          if (resetAtMs === null || anchor < resetAtMs) {
            resetAtMs = anchor;
          }
        }
      }
      if (resetAtMs === null && remaining < 100) {
        resetAtMs = nextRecoveryMs(provider, quota, nowMs);
      }
    }
  } else if (fullLane.remaining !== null) {
    remaining = fullLane.remaining;
    resetAtMs = futureMs(fullLane.anchorMs) ?? nextRecoveryMs(provider, quota, nowMs);
  } else {
    resetAtMs = nextRecoveryMs(provider, quota, nowMs);
  }

  const tone: QuotaTone | null =
    remaining === null
      ? null
      : remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD
        ? 'high'
        : remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
          ? 'medium'
          : 'low';

  const low = tone === 'low';
  const resetUrgent =
    resetAtMs !== null &&
    resetAtMs - nowMs > 0 &&
    resetAtMs - nowMs < HOUR_MS &&
    (remaining === null || remaining < QUOTA_PROGRESS_HIGH_THRESHOLD);

  return {
    status: 'success',
    remaining,
    windowLabel,
    resetAtMs,
    tone,
    low,
    resetUrgent,
  };
}
