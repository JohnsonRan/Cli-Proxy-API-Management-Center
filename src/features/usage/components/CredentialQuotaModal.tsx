import { Suspense, lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { ProviderBadge } from './Labels';
import styles from '../UsagePage.module.scss';

// Loaded lazily so `OverviewTab` can be imported under `bun test` without triggering
// `AuthFileQuotaSection`'s module-level `bindQuotaClasses` against uncompiled `.module.scss`.
// Vite's `codeSplitting: false` + singlefile config still inlines it into `dist/index.html`.
const LazyAuthFileQuotaSection = lazy(() =>
  import('@/features/authFiles/components/AuthFileQuotaSection').then((mod) => ({
    default: mod.AuthFileQuotaSection,
  }))
);

export interface CredentialQuotaModalTarget {
  entry: QuotaFileEntry;
  credentialLabel: string;
  provider: string;
}

export function CredentialQuotaModal({
  target,
  disableControls,
  onClose,
}: {
  target: CredentialQuotaModalTarget | null;
  disableControls: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<CredentialQuotaModalTarget | null>(target);

  useEffect(() => {
    if (target) setSnapshot(target);
  }, [target]);

  const active = target ?? snapshot;
  if (!active) return null;

  const displayName = getQuotaDisplayName(active.entry.file);
  const showFileName = Boolean(displayName && displayName !== active.credentialLabel);

  return (
    <Modal
      open={target !== null}
      closeOnBackdrop
      title={t('usage_stats.quota_modal_title')}
      onClose={onClose}
      width={480}
      footer={
        <Button size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className={styles.quotaModalBody}>
        <div className={styles.quotaModalHeader}>
          <div className={styles.quotaModalIdentity}>
            <span className={styles.cellStrong}>{active.credentialLabel}</span>
            {showFileName && (
              <span className={`${styles.quotaModalFile} ${styles.mono}`}>{displayName}</span>
            )}
          </div>
          <ProviderBadge provider={active.provider || active.entry.type} />
        </div>
        <Suspense fallback={null}>
          <LazyAuthFileQuotaSection
            key={getQuotaCacheKey(active.entry.file)}
            file={active.entry.file}
            quotaType={active.entry.type}
            disableControls={disableControls}
          />
        </Suspense>
      </div>
    </Modal>
  );
}
