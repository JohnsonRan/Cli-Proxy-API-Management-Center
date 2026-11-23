import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconPlus, IconTrash2, IconX } from '@/components/ui/icons';
import type { ClientKeyScope } from '@/services/api/keyScopes';
import { isOptionPick, validateKeyScopes } from '@/utils/keyScope';
import styles from './ApiKeysPage.module.scss';

interface ScopeDraft extends ClientKeyScope {
  id: string;
  pending: string;
}

interface ClientKeyScopesCardProps {
  scopes: readonly ClientKeyScope[];
  providerSuggestions: readonly string[];
  loading: boolean;
  disabled: boolean;
  onSave: (next: ClientKeyScope[]) => Promise<boolean>;
}

let draftSeq = 0;
const toDraft = (scope: ClientKeyScope): ScopeDraft => ({
  ...scope,
  providers: [...scope.providers],
  id: `scope-${++draftSeq}`,
  pending: '',
});

/** Pending text in a provider input counts as entered, so Save never silently drops it. */
const commitDraft = (draft: ScopeDraft): ClientKeyScope => {
  const providers = [...draft.providers];
  draft.pending
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .forEach((name) => {
      if (!providers.some((existing) => existing.toLowerCase() === name.toLowerCase()))
        providers.push(name);
    });
  return { keyPrefix: draft.keyPrefix.trim(), providers };
};

const sameScopes = (left: readonly ClientKeyScope[], right: readonly ClientKeyScope[]) =>
  JSON.stringify(left) === JSON.stringify(right);

export function ClientKeyScopesCard({
  scopes,
  providerSuggestions,
  loading,
  disabled,
  onSave,
}: ClientKeyScopesCardProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const [drafts, setDrafts] = useState<ScopeDraft[]>(() => scopes.map(toDraft));
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    setDrafts(scopes.map(toDraft));
    setShowErrors(false);
  }, [scopes]);

  const committed = useMemo(() => drafts.map(commitDraft), [drafts]);
  const errors = useMemo(() => validateKeyScopes(committed), [committed]);
  const dirty = !sameScopes(committed, scopes);
  const busy = disabled || saving || loading;
  const listId = `${baseId}-providers`;

  const update = (id: string, patch: Partial<ScopeDraft>) =>
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
    );

  const commitPending = (draft: ScopeDraft) => {
    const next = commitDraft(draft);
    update(draft.id, { providers: next.providers, pending: '' });
  };

  const onProviderKeyDown = (event: KeyboardEvent<HTMLInputElement>, draft: ScopeDraft) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitPending(draft);
    } else if (event.key === 'Backspace' && !draft.pending && draft.providers.length > 0) {
      update(draft.id, { providers: draft.providers.slice(0, -1) });
    }
  };

  const handleSave = async () => {
    if (errors.some(Boolean)) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await onSave(committed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      className={styles.scopeCard}
      title={
        <div className={styles.scopeTitle}>
          <span>{t('api_keys_page.scopes.title')}</span>
          <small>{t('api_keys_page.scopes.description')}</small>
        </div>
      }
      extra={
        <div className={styles.scopeActions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !dirty}
            onClick={() => {
              setDrafts(scopes.map(toDraft));
              setShowErrors(false);
            }}
          >
            {t('api_keys_page.scopes.reset')}
          </Button>
          <Button
            size="sm"
            disabled={busy || !dirty}
            loading={saving}
            onClick={() => void handleSave()}
          >
            {t('api_keys_page.scopes.save')}
          </Button>
        </div>
      }
    >
      <datalist id={listId}>
        {providerSuggestions.map((provider) => (
          <option key={provider} value={provider} />
        ))}
      </datalist>
      <div className={styles.scopeBody}>
        {drafts.length === 0 ? (
          <p className={styles.scopeEmpty}>{t('api_keys_page.scopes.empty')}</p>
        ) : (
          <div className={styles.scopeList}>
            {drafts.map((draft, index) => {
              const rowId = `${baseId}-${draft.id}`;
              const error = showErrors ? errors[index] : undefined;
              return (
                <div
                  key={draft.id}
                  className={styles.scopeRow}
                  data-invalid={error ? '' : undefined}
                >
                  <div className={styles.scopeField}>
                    <label htmlFor={`${rowId}-prefix`}>
                      {t('api_keys_page.scopes.prefix_label')}
                    </label>
                    <input
                      id={`${rowId}-prefix`}
                      className="input"
                      value={draft.keyPrefix}
                      placeholder="sk-team-"
                      disabled={busy}
                      aria-invalid={error === 'prefix_required' || error === 'prefix_duplicate'}
                      aria-describedby={error ? `${rowId}-error` : undefined}
                      onChange={(event) => update(draft.id, { keyPrefix: event.target.value })}
                    />
                  </div>
                  <div className={styles.scopeField}>
                    <label htmlFor={`${rowId}-providers`}>
                      {t('api_keys_page.scopes.providers_label')}
                    </label>
                    <div className={styles.scopeChips}>
                      {draft.providers.map((provider) => (
                        <span key={provider} className={styles.scopeChip}>
                          {provider}
                          <button
                            type="button"
                            className={styles.scopeChipRemove}
                            disabled={busy}
                            aria-label={t('api_keys_page.scopes.remove_provider', { provider })}
                            onClick={() =>
                              update(draft.id, {
                                providers: draft.providers.filter((item) => item !== provider),
                              })
                            }
                          >
                            <IconX size={11} />
                          </button>
                        </span>
                      ))}
                      <input
                        id={`${rowId}-providers`}
                        className={styles.scopeChipInput}
                        list={listId}
                        value={draft.pending}
                        placeholder={t('api_keys_page.scopes.providers_placeholder')}
                        disabled={busy}
                        aria-invalid={error === 'providers_required'}
                        aria-describedby={
                          error ? `${rowId}-error ${baseId}-hint` : `${baseId}-hint`
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          // Only a picked datalist option commits at once; typing `codex` on the
                          // way to `codex-relay` must not split the name into two chips.
                          if (
                            isOptionPick(event.nativeEvent) &&
                            providerSuggestions.includes(value)
                          ) {
                            commitPending({ ...draft, pending: value });
                          } else update(draft.id, { pending: value });
                        }}
                        onKeyDown={(event) => onProviderKeyDown(event, draft)}
                        onBlur={() => draft.pending.trim() && commitPending(draft)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.iconBtnDanger} ${styles.scopeRemove}`}
                    disabled={busy}
                    title={t('api_keys_page.scopes.remove_rule')}
                    aria-label={t('api_keys_page.scopes.remove_rule')}
                    onClick={() =>
                      setDrafts((current) => current.filter((item) => item.id !== draft.id))
                    }
                  >
                    <IconTrash2 size={15} />
                  </button>
                  {error ? (
                    <div id={`${rowId}-error`} className={styles.scopeError} role="alert">
                      {t(`api_keys_page.scopes.error_${error}`)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        <p id={`${baseId}-hint`} className={styles.scopeHint}>
          {t('api_keys_page.scopes.hint')}
        </p>
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() =>
              setDrafts((current) => [...current, toDraft({ keyPrefix: '', providers: [] })])
            }
          >
            <IconPlus size={14} />
            <span>{t('api_keys_page.scopes.add_rule')}</span>
          </Button>
        </div>
      </div>
    </Card>
  );
}
