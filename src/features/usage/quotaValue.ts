/**
 * Quota value: what 100% of a subscription quota window is worth at API prices, estimated from
 * the usage a credential needed to reach its window percentage and fitted statistical models.
 * Pure and React-free.
 */

import type { UsageQuotaModel, UsageQuotaWindow } from '@/services/api/usageStore';

/**
 * Below this percentage the integer (Codex) or 1% (Claude) resolution of the reported
 * percentage dominates the estimate, so it is shown but not used as the reference value.
 */
export const MIN_RELIABLE_PERCENT = 5;

export type WindowIssue = 'low' | 'unpriced' | null;

/**
 * Returns 'low' when the percentage is too small or cost is null, 'unpriced' when any request
 * lacked pricing data, or null when the window is reliable.
 */
export const windowIssue = (w: UsageQuotaWindow): WindowIssue => {
  const own = typeof w.ownPercent === 'number' ? w.ownPercent : w.usedPercent;
  if (w.fullCost === null || own < MIN_RELIABLE_PERCENT) return 'low';
  if ((w.usage?.unpricedRequests ?? 0) > 0) return 'unpriced';
  return null;
};

export const isReliableWindow = (w: UsageQuotaWindow): boolean => windowIssue(w) === null;

export interface QuotaReferenceEstimate {
  source: 'model' | 'window';
  fullCost: number;
  fullCostLow: number | null;
  fullCostHigh: number | null;
  ciPercent: number | null;
  tokens: number | null;
}

export interface QuotaPeriodValue {
  periodSeconds: number;
  /** The newest window instance. */
  current: UsageQuotaWindow;
  /** The newest instance reliable enough to quote, or null. */
  estimate: UsageQuotaWindow | null;
  /** The statistical model fitted across history for this credential and period, if available. */
  model: UsageQuotaModel | null;
  /** Preferred reference estimate: from fitted model if available, else latest reliable window. */
  reference: QuotaReferenceEstimate | null;
  /** Every instance, oldest first. */
  history: UsageQuotaWindow[];
}

export interface CredentialQuotaValue {
  /** Unique per credential and pool. */
  key: string;
  authIndex: string;
  provider: string;
  /** Model family of a per-family quota (Antigravity), empty for credential-wide quotas. */
  pool: string;
  /** Shortest period first. Windows are paired by period, never by provider window name. */
  periods: QuotaPeriodValue[];
  /** Longest period's reference estimate divided by the shortest one's: how many short windows a long one holds. */
  ratio: number | null;
}

const quotaKey = (authIndex: string, pool: string) => (pool ? `${authIndex}:${pool}` : authIndex);

/** Display name of a quota pool. */
export const formatPool = (pool: string): string =>
  pool === 'gemini' ? 'Gemini' : pool === 'claude-gpt' ? 'Claude/GPT' : pool;

/** Group window instances and fitted models per credential, pool and period. Credentials with the most valuable estimate come first. */
export function buildQuotaValues(
  windows: readonly UsageQuotaWindow[],
  models?: readonly UsageQuotaModel[]
): CredentialQuotaValue[] {
  const byCredential = new Map<string, Map<number, UsageQuotaWindow[]>>();
  const first = new Map<string, UsageQuotaWindow>();
  for (const w of windows) {
    if (!w.authIndex || w.periodSeconds <= 0) continue;
    const key = quotaKey(w.authIndex, w.pool);
    first.set(key, w);
    let periods = byCredential.get(key);
    if (!periods) byCredential.set(key, (periods = new Map()));
    const list = periods.get(w.periodSeconds) ?? [];
    list.push(w);
    periods.set(w.periodSeconds, list);
  }

  const out: CredentialQuotaValue[] = [];
  for (const [key, periods] of byCredential) {
    const meta = first.get(key);
    if (!meta) continue;
    const { authIndex, provider, pool } = meta;
    const values: QuotaPeriodValue[] = [...periods.entries()]
      .sort(([a], [b]) => a - b)
      .map(([periodSeconds, list]) => {
        const history = [...list].sort((a, b) => a.resetAt - b.resetAt);
        const reliable = history.filter(isReliableWindow);
        const estimate = reliable[reliable.length - 1] ?? null;

        const matchingModel =
          models?.find(
            (m) => m.authIndex === authIndex && m.pool === pool && m.periodSeconds === periodSeconds
          ) ?? null;

        let reference: QuotaReferenceEstimate | null = null;
        if (matchingModel && matchingModel.status === 'fitted' && matchingModel.fullCost !== null) {
          const tokenSource =
            estimate ??
            history
              .filter((w) => (w.ownPercent ?? w.usedPercent) >= MIN_RELIABLE_PERCENT)
              .slice(-1)[0] ??
            null;
          reference = {
            source: 'model',
            fullCost: matchingModel.fullCost,
            fullCostLow: matchingModel.fullCostLow,
            fullCostHigh: matchingModel.fullCostHigh,
            ciPercent: matchingModel.ciPercent,
            tokens: tokenSource?.fullTokens ?? null,
          };
        } else if (estimate && estimate.fullCost !== null) {
          reference = {
            source: 'window',
            fullCost: estimate.fullCost,
            fullCostLow: null,
            fullCostHigh: null,
            ciPercent: null,
            tokens: estimate.fullTokens,
          };
        }

        return {
          periodSeconds,
          current: history[history.length - 1],
          estimate,
          model: matchingModel,
          reference,
          history,
        };
      });

    const short = values[0]?.reference?.fullCost ?? null;
    const long = values.length > 1 ? (values[values.length - 1].reference?.fullCost ?? null) : null;
    out.push({
      key,
      authIndex,
      provider,
      pool,
      periods: values,
      ratio: short && long !== null ? long / short : null,
    });
  }
  const best = (c: CredentialQuotaValue) =>
    Math.max(0, ...c.periods.map((p) => p.reference?.fullCost ?? 0));
  return out.sort((a, b) => best(b) - best(a) || a.key.localeCompare(b.key));
}

/** Period label such as 5h, 7d or 90m. */
export function formatPeriod(seconds: number): string {
  if (seconds > 0 && seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds > 0 && seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${Math.round(seconds / 60)}m`;
}

/** Every period any credential reports, shortest first. */
export const quotaPeriods = (values: readonly CredentialQuotaValue[]): number[] =>
  [...new Set(values.flatMap((c) => c.periods.map((p) => p.periodSeconds)))].sort((a, b) => a - b);
