/**
 * Command Code 额度渲染体：套餐与剩余额度摘要 + 窗口水位条。
 * 行结构与 Kimi 相同（used / limit / resetAtMs），水位条沿用 KimiQuotaBody。
 */

import { useTranslation } from 'react-i18next';
import type { CommandCodeQuotaState } from '@/types';
import type { QuotaBodyProps } from '../../types';
import { KimiQuotaBody } from '../kimi/KimiQuotaBody';

const formatUsd = (value: number, locale?: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);

export function CommandCodeQuotaBody({ quota, classes }: QuotaBodyProps<CommandCodeQuotaState>) {
  const { t, i18n } = useTranslation();
  const rows = quota.rows ?? [];
  const parts: string[] = [];
  if (quota.plan) parts.push(t('commandcode_quota.plan', { plan: quota.plan }));
  if (typeof quota.creditsLeft === 'number') {
    parts.push(
      t('commandcode_quota.credits_left', {
        amount: formatUsd(quota.creditsLeft, i18n.resolvedLanguage),
      })
    );
  }

  if (rows.length === 0 && parts.length === 0) {
    return <div className={classes.quotaMessage}>{t('commandcode_quota.empty_data')}</div>;
  }

  return (
    <>
      {parts.length > 0 && <div className={classes.quotaMessage}>{parts.join(' · ')}</div>}
      {rows.length > 0 && (
        <KimiQuotaBody quota={{ status: quota.status, rows }} classes={classes} />
      )}
    </>
  );
}
