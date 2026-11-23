import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { UpstreamQuotaBody } from '@/features/quota/components/UpstreamQuotaBody';
import { getQuotaBodyClasses } from '@/features/quota/components/quotaBodyClasses';
import { useThemeStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import type { ProviderResource } from '../types';
import {
  collectUpstreamQuotaTargets,
  fetchUpstreamQuota,
  type UpstreamQuotaResult,
} from '../upstreamQuota';
import styles from './UpstreamQuotaPanel.module.scss';

interface UpstreamQuotaPanelsProps {
  resources: ProviderResource[];
  showMaskedKeys: boolean;
}

export function UpstreamQuotaPanels({ resources, showMaskedKeys }: UpstreamQuotaPanelsProps) {
  const { t } = useTranslation();
  const seen = new Set<string>();
  return resources.flatMap(collectUpstreamQuotaTargets).map(({ authIndex, baseUrl, maskedKey }) => {
    if (seen.has(authIndex)) return null;
    seen.add(authIndex);
    return (
      <UpstreamQuotaPanel
        key={JSON.stringify([authIndex, baseUrl])}
        authIndex={authIndex}
        baseUrl={baseUrl}
        title={
          showMaskedKeys && maskedKey
            ? t('providersPage.upstreamQuota.titleForKey', { key: maskedKey })
            : undefined
        }
      />
    );
  });
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
function UpstreamQuotaPanel({ authIndex, baseUrl, title }: UpstreamQuotaPanelProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
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
      {result ? (
        <UpstreamQuotaBody
          result={result}
          resolvedTheme={resolvedTheme}
          classes={getQuotaBodyClasses()}
        />
      ) : null}
    </div>
  );
}
