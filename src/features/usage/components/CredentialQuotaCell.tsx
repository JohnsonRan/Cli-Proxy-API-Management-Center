import type { KeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import type { CredentialQuotaSummary } from '../quota';
import styles from '../UsagePage.module.scss';

export interface CredentialQuotaCellProps {
  entry: QuotaFileEntry | null;
  summary: CredentialQuotaSummary | null;
  credentialLabel: string;
  nowMs: number;
  onOpen: () => void;
}

export function CredentialQuotaCell({
  entry,
  summary,
  credentialLabel,
  nowMs,
  onOpen,
}: CredentialQuotaCellProps) {
  const { t, i18n } = useTranslation();

  if (!entry) {
    return <span className={styles.muted}>—</span>;
  }

  const current: CredentialQuotaSummary = summary ?? {
    status: 'idle',
    remaining: null,
    windowLabel: '',
    resetAtMs: null,
    tone: null,
    low: false,
    resetUrgent: false,
  };

  const locale = i18n.resolvedLanguage || i18n.language;
  const resetText =
    current.resetAtMs !== null
      ? t('usage_stats.quota_resets', {
          time: formatRelativeInstant(current.resetAtMs, nowMs, locale),
        })
      : null;

  const pct = current.remaining !== null ? Math.round(current.remaining) : null;

  const statusText =
    pct !== null
      ? resetText
        ? `${pct}% · ${resetText}`
        : `${pct}%`
      : current.status === 'loading'
        ? t('usage_stats.quota_loading')
        : current.status === 'error'
          ? t('usage_stats.quota_error')
          : current.status === 'success'
            ? resetText
              ? `${t('usage_stats.quota_details')} · ${resetText}`
              : t('usage_stats.quota_details')
            : t('usage_stats.quota_unloaded');

  const openLabel = t('usage_stats.quota_open_for', { name: credentialLabel });
  const ariaLabel = `${openLabel} — ${statusText}`;

  const tooltip =
    pct !== null
      ? [
          current.windowLabel,
          `${pct}%`,
          current.resetAtMs !== null ? formatInstantShort(current.resetAtMs) : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : openLabel;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onOpen();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.stopPropagation();
    }
  };

  const fillClass =
    current.tone === 'high'
      ? styles.quotaFillHigh
      : current.tone === 'medium'
        ? styles.quotaFillMedium
        : styles.quotaFillLow;
  const pctClass =
    current.tone === 'high'
      ? styles.quotaPctHigh
      : current.tone === 'medium'
        ? styles.quotaPctMedium
        : styles.quotaPctLow;

  return (
    <button
      type="button"
      className={styles.quotaCellButton}
      title={tooltip}
      aria-label={ariaLabel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {pct !== null ? (
        <>
          <span className={styles.quotaCellTop}>
            <span className={styles.quotaTrack} aria-hidden="true">
              <span className={`${styles.quotaFill} ${fillClass}`} style={{ width: `${pct}%` }} />
            </span>
            <span className={pctClass}>{pct}%</span>
          </span>
          {resetText && (
            <span
              className={
                current.resetUrgent || current.low ? styles.quotaResetUrgent : styles.quotaResetSub
              }
            >
              {resetText}
            </span>
          )}
        </>
      ) : current.status === 'loading' ? (
        <span className={styles.quotaStatusIdle}>{t('usage_stats.quota_loading')}</span>
      ) : current.status === 'error' ? (
        <span className={styles.quotaStatusError}>{t('usage_stats.quota_error')}</span>
      ) : current.status === 'success' ? (
        <>
          <span className={styles.quotaStatusIdle}>{t('usage_stats.quota_details')}</span>
          {resetText && (
            <span className={current.resetUrgent ? styles.quotaResetUrgent : styles.quotaResetSub}>
              {resetText}
            </span>
          )}
        </>
      ) : (
        <span className={styles.quotaStatusIdle}>{t('usage_stats.quota_unloaded')}</span>
      )}
    </button>
  );
}
