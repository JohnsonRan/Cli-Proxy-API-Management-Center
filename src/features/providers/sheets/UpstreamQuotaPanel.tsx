import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { QUOTA_RELAY_PROVIDER } from '@/utils/constants';
import { getErrorMessage } from '@/utils/helpers';
import { formatQuotaResetTime } from '@/utils/quota';
import {
  fetchUpstreamQuota,
  lowestRemainingPercent,
  type UpstreamQuotaBalance,
  type UpstreamQuotaCredential,
  type UpstreamQuotaResult,
  type UpstreamQuotaWindow,
} from '../upstreamQuota';
import styles from './UpstreamQuotaPanel.module.scss';

const KNOWN_WINDOWS = new Set([
  'five_hour',
  'weekly',
  'monthly',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_oauth_apps',
  'seven_day_cowork',
  'seven_day_fable',
  'code_review_five_hour',
  'code_review_weekly',
  'code_review_monthly',
]);

const KNOWN_BALANCES = new Set([
  'credits',
  'rate_limit_resets',
  'extra_usage',
  'on_demand',
  'prepaid',
]);

const windowLabel = (t: TFunction, window: UpstreamQuotaWindow): string => {
  const known = KNOWN_WINDOWS.has(window.id)
    ? t(`providersPage.upstreamQuota.windows.${window.id}`)
    : null;
  return window.label && !known ? window.label : (known ?? window.label ?? window.id);
};

const balanceLabel = (t: TFunction, balance: UpstreamQuotaBalance): string =>
  KNOWN_BALANCES.has(balance.id)
    ? t(`providersPage.upstreamQuota.balances.${balance.id}`)
    : (balance.label ?? balance.id);

const formatAmount = (value: number, unit: string | null): string => {
  const rounded = Math.round(value * 100) / 100;
  if (!unit || unit === 'count' || unit === 'credits') return String(rounded);
  if (unit === 'usd') return `$${rounded}`;
  return `${rounded} ${unit.toUpperCase()}`;
};

const remainingClass = (remaining: number | null): string => {
  if (remaining === null) return styles.fillUnknown;
  if (remaining >= 70) return styles.fillHigh;
  if (remaining >= 30) return styles.fillMedium;
  return styles.fillLow;
};

function WindowRow({ window }: { window: UpstreamQuotaWindow }) {
  const { t } = useTranslation();
  const remaining =
    window.usedPercent === null ? null : Math.max(0, Math.min(100, 100 - window.usedPercent));
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{windowLabel(t, window)}</span>
      <div className={styles.meter} aria-hidden="true">
        <div
          className={`${styles.meterFill} ${remainingClass(remaining)}`}
          style={{ width: `${remaining ?? 0}%` }}
        />
      </div>
      <span className={styles.rowValue}>
        {remaining === null
          ? t('providersPage.upstreamQuota.unknown')
          : t('providersPage.upstreamQuota.remainingPercent', { percent: Math.round(remaining) })}
      </span>
      <span className={styles.rowReset}>
        {window.resetAt
          ? t('providersPage.upstreamQuota.resetsAt', {
              time: formatQuotaResetTime(window.resetAt),
            })
          : ''}
      </span>
    </div>
  );
}

function BalanceRow({ balance }: { balance: UpstreamQuotaBalance }) {
  const { t } = useTranslation();
  let value: string;
  if (balance.unlimited) {
    value = t('providersPage.upstreamQuota.unlimited');
  } else if (balance.remaining !== null && balance.limit !== null) {
    value = t('providersPage.upstreamQuota.remainingOf', {
      remaining: formatAmount(balance.remaining, balance.unit),
      limit: formatAmount(balance.limit, balance.unit),
    });
  } else if (balance.remaining !== null) {
    value = formatAmount(balance.remaining, balance.unit);
  } else if (balance.used !== null) {
    value = t('providersPage.upstreamQuota.usedAmount', {
      used: formatAmount(balance.used, balance.unit),
    });
  } else {
    value = t('providersPage.upstreamQuota.unknown');
  }
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{balanceLabel(t, balance)}</span>
      <span className={styles.rowValueWide}>{value}</span>
    </div>
  );
}

/** One upstream account; relays nest the accounts of the proxy further up. */
export function UpstreamQuotaCredentialView({
  credential,
}: {
  credential: UpstreamQuotaCredential;
}) {
  const { t } = useTranslation();
  const remaining = lowestRemainingPercent(credential);
  const isRelay = credential.provider === QUOTA_RELAY_PROVIDER;
  const hint =
    credential.status === 'error'
      ? (credential.error ?? t('providersPage.upstreamQuota.failed'))
      : remaining === null
        ? (credential.plan ?? '')
        : [
            credential.plan,
            t('providersPage.upstreamQuota.remainingPercent', { percent: Math.round(remaining) }),
          ]
            .filter(Boolean)
            .join(' · ');
  const label = (
    <span className={styles.credentialLabel}>
      <span className={styles.credentialName}>{credential.name}</span>
      <span className={styles.credentialProvider}>
        {isRelay ? t('providersPage.upstreamQuota.relay') : credential.provider}
      </span>
    </span>
  );

  return (
    <Collapsible label={label} hint={hint} className={styles.credential}>
      {credential.windows.map((window) => (
        <WindowRow key={window.id} window={window} />
      ))}
      {credential.balances.map((balance) => (
        <BalanceRow key={balance.id} balance={balance} />
      ))}
      {credential.upstream.length > 0 ? (
        <div className={styles.nested}>
          {credential.upstream.map((child, index) => (
            <UpstreamQuotaCredentialView key={`${child.name}-${index}`} credential={child} />
          ))}
        </div>
      ) : null}
      {credential.status === 'ok' &&
      credential.windows.length === 0 &&
      credential.balances.length === 0 &&
      credential.upstream.length === 0 ? (
        <p className={styles.empty}>{t('providersPage.upstreamQuota.noData')}</p>
      ) : null}
      {credential.observedAt ? (
        <p className={styles.observed}>
          {t('providersPage.upstreamQuota.observedAt', {
            time: formatQuotaResetTime(credential.observedAt),
          })}
        </p>
      ) : null}
    </Collapsible>
  );
}

export function UpstreamQuotaResultView({ result }: { result: UpstreamQuotaResult }) {
  const { t } = useTranslation();
  if (!result.ok) {
    return (
      <p className={result.reason === 'unsupported' ? styles.empty : styles.error}>
        {result.reason === 'unsupported'
          ? t('providersPage.upstreamQuota.unsupported')
          : result.message || t('providersPage.upstreamQuota.failed')}
      </p>
    );
  }
  if (result.credentials.length === 0) {
    return <p className={styles.empty}>{t('providersPage.upstreamQuota.noneShared')}</p>;
  }
  return (
    <div className={styles.list}>
      {result.credentials.map((credential, index) => (
        <UpstreamQuotaCredentialView key={`${credential.name}-${index}`} credential={credential} />
      ))}
    </div>
  );
}

interface UpstreamQuotaPanelProps {
  authIndex: string;
  baseUrl: string;
  title?: string;
}

/**
 * Reads, on demand, the quota an upstream CLIProxyAPI shares with this provider's
 * API key. Nothing is requested until the user asks.
 */
export function UpstreamQuotaPanel({ authIndex, baseUrl, title }: UpstreamQuotaPanelProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UpstreamQuotaResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await fetchUpstreamQuota(authIndex, baseUrl));
    } catch (err) {
      setResult({
        ok: false,
        reason: 'error',
        message: getErrorMessage(err, t('providersPage.upstreamQuota.failed')),
      });
    } finally {
      setLoading(false);
    }
  }, [authIndex, baseUrl, t]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>{title ?? t('providersPage.upstreamQuota.title')}</span>
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          {result
            ? t('providersPage.upstreamQuota.refresh')
            : t('providersPage.upstreamQuota.check')}
        </Button>
      </div>
      {result ? <UpstreamQuotaResultView result={result} /> : null}
    </div>
  );
}
