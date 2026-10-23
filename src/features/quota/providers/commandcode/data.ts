/**
 * Command Code 额度数据层。React-free / SCSS-free。
 *
 * 与官方 CLI 的 /usage 读同一组账户接口（凭证的 API key 作 Bearer）：
 * - GET /alpha/billing/credits：剩余额度与 5 小时 / 每周窗口
 * - GET /alpha/billing/subscriptions：套餐 planId、状态与当期结束时间
 */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  CommandCodeQuotaData,
  CommandCodeQuotaRow,
  CommandCodeQuotaState,
} from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import { createStatusError, isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

export const COMMANDCODE_API_BASE_URL = 'https://api.commandcode.ai';
export const COMMANDCODE_CREDITS_URL = `${COMMANDCODE_API_BASE_URL}/alpha/billing/credits`;
export const COMMANDCODE_SUBSCRIPTION_URL = `${COMMANDCODE_API_BASE_URL}/alpha/billing/subscriptions`;

const REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  Accept: 'application/json',
};

/** 官方 CLI 的套餐表（planId 前缀 → 显示名与月度额度，美元）。 */
const PLANS: Record<string, { name: string; monthlyCredits: number }> = {
  'individual-go': { name: 'Go', monthlyCredits: 10 },
  'individual-go-v1': { name: 'Go', monthlyCredits: 10 },
  'individual-goat': { name: 'GOAT', monthlyCredits: 70 },
  'individual-pro': { name: 'Pro', monthlyCredits: 30 },
  'individual-pro-v1': { name: 'Pro', monthlyCredits: 80 },
  'individual-provider': { name: 'Provider', monthlyCredits: 15 },
  'individual-max': { name: 'Max', monthlyCredits: 150 },
  'individual-ultra': { name: 'Ultra', monthlyCredits: 300 },
  'teams-pro': { name: 'Teams Pro', monthlyCredits: 40 },
};

/** 最长前缀匹配，避免 individual-goat 被读成 individual-go。 */
export function resolveCommandCodePlan(
  planId: unknown
): { name: string; monthlyCredits: number } | null {
  if (typeof planId !== 'string') return null;
  const id = planId.trim().toLowerCase().replace(/_/g, '-');
  if (!id) return null;
  const key = Object.keys(PLANS)
    .filter((candidate) => id.startsWith(candidate))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PLANS[key] : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
};

const toNumber = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const toResetMs = (value: unknown): number | null => {
  const n = toNumber(value);
  if (n !== null) return n > 0 ? n : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
};

const WINDOWS = [
  { id: 'five_hour', key: 'fiveHour', labelKey: 'commandcode_quota.five_hour', periodHours: 5 },
  { id: 'weekly', key: 'weekly', labelKey: 'commandcode_quota.weekly', periodHours: 168 },
] as const;

/** 把 credits 与 subscription 两个响应体组装成卡片数据。subscription 可缺省。 */
export function buildCommandCodeQuota(
  creditsBody: unknown,
  subscriptionBody: unknown
): CommandCodeQuotaData | null {
  const creditsRoot = toRecord(creditsBody);
  if (!creditsRoot) return null;
  const credits = isRecord(creditsRoot.credits) ? creditsRoot.credits : {};
  const windowLimits = isRecord(creditsRoot.windowLimits) ? creditsRoot.windowLimits : {};

  const rows: CommandCodeQuotaRow[] = [];
  for (const window of WINDOWS) {
    const raw = windowLimits[window.key];
    if (!isRecord(raw)) continue;
    const cap = toNumber(raw.cap);
    const used = toNumber(raw.used);
    if (cap === null || used === null) continue;
    rows.push({
      id: window.id,
      labelKey: window.labelKey,
      used,
      // 超限时 used 可能等于 cap；cap 为 0 时按超限显示。
      limit: cap,
      resetAtMs: toResetMs(raw.resetAt),
      periodHours: window.periodHours,
    });
  }

  const monthlyRaw = toNumber(credits.monthlyCredits);
  const monthlyLeft = Math.max(0, monthlyRaw ?? 0);
  const purchased = Math.max(0, toNumber(credits.purchasedCredits) ?? 0);
  const free = Math.max(0, toNumber(credits.freeCredits) ?? 0);
  const hasCredits = ['monthlyCredits', 'purchasedCredits', 'freeCredits'].some(
    (key) => toNumber(credits[key]) !== null
  );

  const subscriptionRoot = toRecord(subscriptionBody);
  const subscription =
    subscriptionRoot && isRecord(subscriptionRoot.data) ? subscriptionRoot.data : null;
  const plan = resolveCommandCodePlan(subscription?.planId);
  // 接口只报剩余月度额度：套餐已知且订阅有效时才能画出「已用 / 总额」。
  if (plan && subscription?.status === 'active' && monthlyRaw !== null) {
    const total = Math.max(plan.monthlyCredits, monthlyLeft);
    rows.push({
      id: 'monthly',
      labelKey: 'commandcode_quota.monthly',
      used: total - monthlyLeft,
      limit: total,
      resetAtMs: toResetMs(subscription.currentPeriodEnd),
      periodHours: null,
    });
  }

  if (rows.length === 0 && !hasCredits) return null;
  return {
    rows,
    plan: plan?.name ?? null,
    creditsLeft: hasCredits ? monthlyLeft + purchased + free : null,
  };
}

export const isCommandCodeFile = (file: AuthFileItem): boolean =>
  resolveAuthProvider(file) === 'commandcode';

const fetchCommandCodeQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<CommandCodeQuotaData> => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) {
    throw new Error(t('commandcode_quota.missing_auth_index'));
  }

  const generation = captureQuotaCacheGeneration(file.name);
  const [credits, subscription] = await Promise.all([
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: COMMANDCODE_CREDITS_URL,
      header: { ...REQUEST_HEADERS },
    }),
    apiCallApi
      .request({
        authIndex,
        method: 'GET',
        url: COMMANDCODE_SUBSCRIPTION_URL,
        header: { ...REQUEST_HEADERS },
      })
      .catch(() => null),
  ]);
  if (!commitIfQuotaCacheCurrent(generation, () => {})) {
    throw new Error(t('commandcode_quota.stale_request'));
  }

  if (credits.statusCode < 200 || credits.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(credits), credits.statusCode);
  }
  const subscriptionOk =
    subscription && subscription.statusCode >= 200 && subscription.statusCode < 300;
  const data = buildCommandCodeQuota(
    credits.body ?? credits.bodyText,
    subscriptionOk ? (subscription.body ?? subscription.bodyText) : null
  );
  if (!data) {
    throw new Error(t('commandcode_quota.empty_data'));
  }
  return data;
};

export const COMMANDCODE_CONFIG: QuotaProviderData<CommandCodeQuotaState, CommandCodeQuotaData> = {
  type: 'commandcode',
  i18nPrefix: 'commandcode_quota',
  filterFn: (file) => isCommandCodeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchCommandCodeQuota,
  storeSelector: (state) => state.commandcodeQuota,
  storeSetter: 'setCommandcodeQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
};
