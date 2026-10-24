import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { IconPencil } from '@/components/ui/icons';
import {
  normalizeExcludedRules,
  type ExcludedModelCandidate,
  type ExcludedModelsCatalogState,
} from '@/components/excludedModels';
import type { GlobalClientModelRules } from '@/services/api/apiKeys';
import { summarizeApiKeyModelScope } from '@/utils/apiKeyScope';
import { ClientKeyModelRulesField } from './ClientKeyModelRulesField';
import styles from './ApiKeysPage.module.scss';

interface GlobalClientModelRulesCardProps {
  rules: GlobalClientModelRules;
  loading: boolean;
  disabled: boolean;
  candidates: readonly ExcludedModelCandidate[];
  catalogState: ExcludedModelsCatalogState;
  onRetryCatalog: () => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSave: (next: GlobalClientModelRules) => Promise<boolean>;
}

const sameRuleList = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify(normalizeExcludedRules(left)) === JSON.stringify(normalizeExcludedRules(right));

export function GlobalClientModelRulesCard({
  rules,
  loading,
  disabled,
  candidates,
  catalogState,
  onRetryCatalog,
  editing,
  onEditingChange,
  onSave,
}: GlobalClientModelRulesCardProps) {
  const { t } = useTranslation();
  const [draftAllowed, setDraftAllowed] = useState<string[]>(() =>
    normalizeExcludedRules(rules.models)
  );
  const [draftExcluded, setDraftExcluded] = useState<string[]>(() =>
    normalizeExcludedRules(rules.excludedModels)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraftAllowed(normalizeExcludedRules(rules.models));
    setDraftExcluded(normalizeExcludedRules(rules.excludedModels));
  }, [editing, rules.excludedModels, rules.models]);

  const dirty =
    !sameRuleList(draftAllowed, rules.models) || !sameRuleList(draftExcluded, rules.excludedModels);
  const busy = loading || disabled || saving;
  const scope = summarizeApiKeyModelScope(rules);

  const handleStartEdit = () => {
    setDraftAllowed(normalizeExcludedRules(rules.models));
    setDraftExcluded(normalizeExcludedRules(rules.excludedModels));
    onEditingChange(true);
  };

  const handleCancel = () => {
    setDraftAllowed(normalizeExcludedRules(rules.models));
    setDraftExcluded(normalizeExcludedRules(rules.excludedModels));
    onEditingChange(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const ok = await onSave({
        models: normalizeExcludedRules(draftAllowed),
        excludedModels: normalizeExcludedRules(draftExcluded),
      });
      if (ok) {
        onEditingChange(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      className={styles.globalRulesCard}
      title={
        <div className={styles.globalRulesTitle}>
          <span>{t('api_keys_page.global_models.title')}</span>
          <small>{t('api_keys_page.global_models.description')}</small>
        </div>
      }
      extra={
        editing ? (
          <div className={styles.globalRulesActions}>
            <Button variant="secondary" size="sm" disabled={saving} onClick={handleCancel}>
              {t('common.cancel', '取消')}
            </Button>
            <Button
              size="sm"
              disabled={busy || !dirty}
              loading={saving}
              onClick={() => void handleSave()}
            >
              {t('common.save', '保存')}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" disabled={busy} onClick={handleStartEdit}>
            <IconPencil size={14} />
            <span>{t('api_keys_page.global_models.edit')}</span>
          </Button>
        )
      }
    >
      <div className={styles.globalRulesBody}>
        {editing ? (
          <div className={styles.globalRulesGrid}>
            <ClientKeyModelRulesField
              label={t('api_keys_page.global_models.allow_label')}
              hint={t('api_keys_page.global_models.allow_hint')}
              tone="allow"
              value={draftAllowed}
              onChange={setDraftAllowed}
              candidates={candidates}
              catalogState={catalogState}
              onRetry={onRetryCatalog}
              disabled={busy}
            />
            <ClientKeyModelRulesField
              label={t('api_keys_page.global_models.exclude_label')}
              hint={t('api_keys_page.global_models.exclude_hint')}
              tone="exclude"
              value={draftExcluded}
              onChange={setDraftExcluded}
              candidates={candidates}
              catalogState={catalogState}
              onRetry={onRetryCatalog}
              disabled={busy}
            />
          </div>
        ) : loading ? (
          <Skeleton width={220} height={22} rounded={6} />
        ) : (
          <div className={styles.globalRulesSummary}>
            <div className={styles.modelTagList}>
              {!scope.restricted ? (
                <>
                  <span className={styles.allModelsBadge}>{t('api_keys_page.all_models')}</span>
                  <span className={styles.globalRulesEmptyNote}>
                    {t('api_keys_page.global_models.empty')}
                  </span>
                </>
              ) : (
                <>
                  {scope.visibleAllowed.map((model) => (
                    <span key={model} className={styles.modelTag} title={model}>
                      {model}
                    </span>
                  ))}
                  {scope.hiddenAllowedCount > 0 && (
                    <span className={styles.modelMoreTag} title={scope.allowed.join(', ')}>
                      {t('excluded_models.chips_more', { n: scope.hiddenAllowedCount })}
                    </span>
                  )}
                  {scope.excluded.length > 0 && (
                    <span className={styles.modelExcludedTag} title={scope.excluded.join(', ')}>
                      {t('api_keys_page.models_excluded_count', { n: scope.excluded.length })}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <p className={styles.globalRulesHint}>{t('api_keys_page.global_models.precedence')}</p>
      </div>
    </Card>
  );
}
