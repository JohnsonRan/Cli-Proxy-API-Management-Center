/**
 * The accounts an upstream proxy shares, drawn with the same rows as the OAuth quota
 * bodies: label, remaining percent and reset on one line, the meter below. Relays are
 * proxies, so their accounts are listed flat with a "via" note instead of nested boxes.
 */

import { useTranslation } from 'react-i18next';
import {
  flattenUpstreamAccounts,
  upstreamBalanceLabel,
  upstreamBalanceValue,
  upstreamWindowLabel,
  type UpstreamQuotaAccount,
  type UpstreamQuotaResult,
} from '@/features/providers/upstreamQuota';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay, formatQuotaResetTime } from '@/utils/quota';
import type { QuotaClassMap } from '../types';
import { QuotaMeter } from './QuotaMeter';
import { QuotaResetLabel } from './QuotaResetLabel';
import styles from './UpstreamQuotaBody.module.scss';

const parseMs = (value: string | null): number | null => {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

function AccountView({
  account,
  resolvedTheme,
  now,
  classes,
}: {
  account: UpstreamQuotaAccount;
  resolvedTheme: ResolvedTheme;
  now: number;
  classes: QuotaClassMap;
}) {
  const { t, i18n } = useTranslation();
  const { credential, via } = account;
  const iconSrc = getAuthFileIcon(credential.provider, resolvedTheme);
  const typeLabel = getTypeLabel(t, credential.provider);
  const observed = credential.observedAt
    ? t('providersPage.upstreamQuota.observedAt', {
        time: formatQuotaResetTime(credential.observedAt),
      })
    : '';
  const empty =
    credential.status === 'ok' &&
    credential.windows.length === 0 &&
    credential.balances.length === 0;

  return (
    <div className={styles.account}>
      <div
        className={styles.accountHead}
        title={[credential.name, observed].filter(Boolean).join('\n')}
      >
        {iconSrc ? (
          <img src={iconSrc} alt={typeLabel} className={styles.accountIcon} />
        ) : (
          <span className={styles.accountIconFallback} aria-label={typeLabel}>
            {typeLabel.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className={styles.accountName}>{credential.name}</span>
        {credential.plan && <span className={styles.accountPlan}>{credential.plan}</span>}
        {via && (
          <span className={styles.accountVia}>
            {t('providersPage.upstreamQuota.via', { name: via })}
          </span>
        )}
      </div>

      {credential.status === 'error' ? (
        <div className={styles.accountError}>
          {credential.error ?? t('providersPage.upstreamQuota.failed')}
        </div>
      ) : null}

      {credential.windows.map((window, index) => {
        const remaining =
          window.usedPercent === null ? null : Math.max(0, Math.min(100, 100 - window.usedPercent));
        const resetDisplay = buildResetDisplay(
          null,
          parseMs(window.resetAt),
          now,
          i18n.resolvedLanguage
        );
        const label = upstreamWindowLabel(t, window);
        return (
          <div key={window.id} className={classes.quotaRow}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel} title={label}>
                {label}
              </span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>
                  {remaining === null ? '--' : `${Math.round(remaining)}%`}
                </span>
                {resetDisplay && <QuotaResetLabel display={resetDisplay} classes={classes} />}
              </div>
            </div>
            <QuotaMeter percent={remaining} classes={classes} index={index} />
          </div>
        );
      })}

      {credential.balances.length > 0 && (
        <div className={classes.codexPlan}>
          {credential.balances.map((balance) => (
            <span key={balance.id} className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{upstreamBalanceLabel(t, balance)}</span>
              <span className={classes.codexPlanValue}>{upstreamBalanceValue(t, balance)}</span>
            </span>
          ))}
        </div>
      )}

      {empty && <div className={styles.accountNote}>{t('providersPage.upstreamQuota.noData')}</div>}
    </div>
  );
}

export function UpstreamQuotaBody({
  result,
  resolvedTheme,
  classes,
}: {
  result: UpstreamQuotaResult;
  resolvedTheme: ResolvedTheme;
  /** The host's quota row classes, as every provider body receives them. */
  classes: QuotaClassMap;
}) {
  const { t } = useTranslation();
  const now = useNow();
  if (!result.ok) {
    return result.reason === 'unsupported' ? (
      <div className={classes.quotaMessage}>{t('providersPage.upstreamQuota.unsupported')}</div>
    ) : (
      <div className={styles.accountError} role="alert">
        {result.message || t('providersPage.upstreamQuota.failed')}
      </div>
    );
  }
  const accounts = flattenUpstreamAccounts(result.credentials);
  if (accounts.length === 0) {
    return (
      <div className={classes.quotaMessage}>{t('providersPage.upstreamQuota.noneShared')}</div>
    );
  }
  return (
    <div className={styles.accounts}>
      {accounts.map((account) => (
        <AccountView
          key={account.path}
          account={account}
          resolvedTheme={resolvedTheme}
          now={now}
          classes={classes}
        />
      ))}
    </div>
  );
}
