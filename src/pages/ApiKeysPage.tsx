import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconSearch,
  IconShield,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { ApiKeyStrengthMeter } from '@/features/config/components/blocks/ApiKeyStrengthMeter';
import {
  normalizeExcludedRules,
  type ExcludedModelCandidate,
  type ExcludedModelsCatalogState,
} from '@/components/excludedModels';
import {
  apiKeysApi,
  type ClientApiKeyItem,
  type GlobalClientModelRules,
} from '@/services/api/apiKeys';
import { guardConfigConnection } from '@/services/api/configValue';
import { keyScopesApi, type ClientKeyScope } from '@/services/api/keyScopes';
import { modelsApi } from '@/services/api/models';
import {
  quotaApiKeysApi,
  quotaCredentialsForKey,
  sameQuotaApiKeys,
  withQuotaCredentials,
  type QuotaApiKeyEntry,
} from '@/services/api/quotaApiKeys';
import { useConfigStore, useNotificationStore } from '@/stores';
import { ClientKeyModelRulesField } from './ClientKeyModelRulesField';
import { ClientKeyQuotaCredentialsField } from './ClientKeyQuotaCredentialsField';
import { ClientKeyScopesCard } from './ClientKeyScopesCard';
import { GlobalClientModelRulesCard } from './GlobalClientModelRulesCard';

function useProxyModelCatalog(enabled: boolean) {
  const [candidates, setCandidates] = useState<ExcludedModelCandidate[]>([]);
  const [catalogState, setCatalogState] = useState<ExcludedModelsCatalogState>('loading');
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    setCatalogState('loading');
    try {
      const items = await modelsApi.listCatalog();
      setCandidates(items.map((item) => ({ id: item.id, displayName: item.display_name })));
      setCatalogState('ready');
      loadedRef.current = true;
    } catch {
      loadedRef.current = false;
      setCatalogState('error');
    }
  }, []);

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    void load();
  }, [enabled, load]);

  return { candidates, catalogState, retry: load };
}
import { generateSecureApiKey } from '@/utils/apiKey';
import {
  DEFAULT_VISIBLE_MODEL_LIMIT,
  hasApiKeyModelRestrictions,
  summarizeApiKeyModelScope,
} from '@/utils/apiKeyScope';
import {
  effectiveKeyScopeProviders,
  KEY_SCOPE_BUILTIN_PROVIDERS,
  resolveKeyScope,
} from '@/utils/keyScope';
import { copyToClipboard } from '@/utils/clipboard';
import { maskApiKey } from '@/utils/format';
import { getErrorMessage } from '@/utils/helpers';
import { isValidApiKeyCharset } from '@/utils/validation';
import styles from './ApiKeysPage.module.scss';

/** How long the copy button keeps its "copied" check mark before reverting. */
const COPIED_FEEDBACK_MS = 1500;

/** Metric value that occupies the same space while the first load is in flight. */
function MetricValue({ loading, children }: PropsWithChildren<{ loading: boolean }>) {
  if (loading) return <Skeleton width={56} height={22} rounded={6} />;
  return <span className={styles.metricValue}>{children}</span>;
}

export function ApiKeysPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const openaiCompatibility = useConfigStore((state) => state.config?.openaiCompatibility);

  const [apiKeyItems, setApiKeyItems] = useState<ClientApiKeyItem[]>([]);
  const apiKeys = useMemo(() => apiKeyItems.map((item) => item.apiKey), [apiKeyItems]);
  const [globalModelRules, setGlobalModelRules] = useState<GlobalClientModelRules>(() => ({
    models: [],
    excludedModels: [],
  }));
  const [globalRulesEditing, setGlobalRulesEditing] = useState(false);
  const [keyScopes, setKeyScopes] = useState<ClientKeyScope[]>([]);
  const [quotaKeys, setQuotaKeys] = useState<QuotaApiKeyEntry[]>([]);
  // Connection the rules, scopes and quota visibility were read from; a save after a
  // connection switch must fail.
  const connectionGuardRef = useRef<() => void>(() => {});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Search & interaction states
  const [searchQuery, setSearchQuery] = useState('');
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(() => new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Add / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [excludedModels, setExcludedModels] = useState<string[]>([]);
  const [quotaCredentials, setQuotaCredentials] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const modelCatalog = useProxyModelCatalog(modalOpen || globalRulesEditing);

  // Delete Modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [targetDeleteIndex, setTargetDeleteIndex] = useState<number | null>(null);

  const nameInputId = useId();
  const apiKeyInputId = useId();
  const nameHintId = `${nameInputId}-hint`;
  const apiKeyHintId = `${apiKeyInputId}-hint`;
  const apiKeyErrorId = `${apiKeyInputId}-error`;

  const loadKeys = useCallback(async () => {
    const assertConnection = guardConfigConnection();
    setLoading(true);
    try {
      const [items, globalRules, scopes, quota] = await Promise.all([
        apiKeysApi.listItems(),
        apiKeysApi.getGlobalModelRules(),
        keyScopesApi.list(),
        quotaApiKeysApi.list(),
      ]);
      assertConnection();
      connectionGuardRef.current = assertConnection;
      setApiKeyItems(items);
      setGlobalModelRules(globalRules);
      setKeyScopes(scopes);
      setQuotaKeys(quota);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showNotification(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  // openai-compatibility entry names are valid scope providers; the store caches the config.
  useEffect(() => {
    void fetchConfig().catch(() => undefined);
  }, [fetchConfig]);

  const providerSuggestions = useMemo(() => {
    const names = new Set<string>(KEY_SCOPE_BUILTIN_PROVIDERS);
    (openaiCompatibility ?? []).forEach((entry) => {
      const name = entry.name?.trim();
      if (name) names.add(name);
    });
    return [...names];
  }, [openaiCompatibility]);

  const handleSaveScopes = useCallback(
    async (next: ClientKeyScope[]) => {
      try {
        await keyScopesApi.replace(next, keyScopes.length === 0, connectionGuardRef.current);
        await fetchConfig(true);
        setKeyScopes(next);
        showNotification(t('common.saved_success', '保存成功'), 'success');
        return true;
      } catch (err) {
        showNotification(getErrorMessage(err), 'error');
        return false;
      }
    },
    [fetchConfig, keyScopes.length, showNotification, t]
  );

  const handleSaveGlobalModelRules = useCallback(
    async (next: GlobalClientModelRules): Promise<boolean> => {
      const assertConnection = connectionGuardRef.current;
      try {
        const saved = await apiKeysApi.replaceGlobalModelRules(
          next,
          globalModelRules,
          assertConnection,
          (committedModels) => {
            setGlobalModelRules((current) => ({ ...current, models: committedModels }));
          }
        );
        setGlobalModelRules(saved);
        clearCache('api-keys');
        void fetchConfig(true).catch(() => undefined);
        showNotification(t('common.saved_success', '保存成功'), 'success');
        return true;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return false;
        showNotification(getErrorMessage(err), 'error');
        return false;
      }
    },
    [clearCache, fetchConfig, globalModelRules, showNotification, t]
  );

  // Drop the pending copy-feedback timer so it cannot fire after unmount.
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  // Compute metrics
  const totalKeys = apiKeys.length;
  const namedCount = useMemo(() => apiKeyItems.filter((item) => !!item.name).length, [apiKeyItems]);

  // Keys that narrow their model scope, by allow-list or by exclusions.
  const restrictedCount = useMemo(
    () =>
      apiKeyItems.filter(
        (item) =>
          hasApiKeyModelRestrictions(item, globalModelRules) ||
          resolveKeyScope(item.apiKey, keyScopes)
      ).length,
    [apiKeyItems, globalModelRules, keyScopes]
  );

  const metricsLoading = loading && apiKeyItems.length === 0;

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = apiKeyItems.map((item, index) => {
      const key = item.apiKey;
      const name = item.name ?? '';
      return { item, key, index, name };
    });

    if (!q) return rows;
    return rows.filter(({ key, name }) => {
      return name.toLowerCase().includes(q) || key.toLowerCase().includes(q);
    });
  }, [apiKeyItems, searchQuery]);

  // Actions
  const toggleReveal = useCallback((key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleCopy = useCallback(
    async (key: string) => {
      const copied = await copyToClipboard(key);
      if (!copied) {
        showNotification(t('notification.copy_failed', '复制失败'), 'error');
        return;
      }

      // Restart the feedback window so a second copy does not clear its own check mark.
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
      setCopiedKey(key);
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setCopiedKey(null);
      }, COPIED_FEEDBACK_MS);
      showNotification(t('api_keys_page.copied', '已复制'), 'success');
    },
    [showNotification, t]
  );

  const openAddModal = () => {
    setEditingIndex(null);
    setNameInput('');
    setKeyInput('');
    setAllowedModels([]);
    setExcludedModels([]);
    setQuotaCredentials([]);
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (item: ClientApiKeyItem, index: number) => {
    setEditingIndex(index);
    setNameInput(item.name ?? '');
    setKeyInput(item.apiKey);
    const activeModels = item.models ?? item.allowedModels ?? [];
    setAllowedModels(normalizeExcludedRules(activeModels));
    setExcludedModels(normalizeExcludedRules(item.excludedModels ?? []));
    setQuotaCredentials(quotaCredentialsForKey(quotaKeys, item.apiKey));
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingIndex(null);
    setNameInput('');
    setKeyInput('');
    setAllowedModels([]);
    setExcludedModels([]);
    setQuotaCredentials([]);
    setFormError('');
  };

  const handleGenerate = () => {
    setKeyInput(generateSecureApiKey());
    setFormError('');
  };

  const refreshConfigAfterSave = useCallback(
    async (assertConnection: () => void, apiKeys: string[]) => {
      // Record the committed keys and invalidate cached/in-flight reads, keeping the rest of
      // the config snapshot so a failed refresh does not blank unrelated consumers.
      updateConfigValue('api-keys', apiKeys);
      try {
        await fetchConfig(true);
        assertConnection();
        showNotification(t('config_management.save_success'), 'success');
      } catch (err) {
        try {
          assertConnection();
        } catch {
          return;
        }
        showNotification(
          `${t('config_management.save_success')}. ${t('notification.refresh_failed')}: ${getErrorMessage(err)}`,
          'warning'
        );
      }
    },
    [fetchConfig, showNotification, t, updateConfigValue]
  );

  const handleSave = useCallback(async () => {
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) {
      setFormError(t('config_management.visual.api_keys.error_empty'));
      return;
    }
    if (!isValidApiKeyCharset(trimmedKey)) {
      setFormError(t('config_management.visual.api_keys.error_invalid'));
      return;
    }

    const nextItem: ClientApiKeyItem = {
      apiKey: trimmedKey,
      name: nameInput.trim() || undefined,
      models: allowedModels.length > 0 ? allowedModels : undefined,
      excludedModels: excludedModels.length > 0 ? excludedModels : undefined,
    };

    setSaving(true);
    try {
      let nextItems: ClientApiKeyItem[];
      let previousKey: string | null = null;
      if (editingIndex !== null && editingIndex >= 0) {
        const oldKey = apiKeyItems[editingIndex].apiKey;
        previousKey = oldKey;
        nextItems = apiKeyItems.map((k, i) => (i === editingIndex ? nextItem : k));
      } else {
        nextItems = [...apiKeyItems, nextItem];
      }

      const nextQuota = withQuotaCredentials(quotaKeys, previousKey, trimmedKey, quotaCredentials);
      const assertConnection = connectionGuardRef.current;
      await quotaApiKeysApi.replaceClientKeys(
        nextItems,
        sameQuotaApiKeys(quotaKeys, nextQuota) ? undefined : nextQuota,
        assertConnection
      );
      assertConnection();
      setApiKeyItems(nextItems);
      setQuotaKeys(nextQuota);
      closeModal();
      await refreshConfigAfterSave(
        assertConnection,
        nextItems.map((item) => item.apiKey)
      );
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [
    allowedModels,
    apiKeyItems,
    editingIndex,
    excludedModels,
    keyInput,
    nameInput,
    quotaCredentials,
    quotaKeys,
    refreshConfigAfterSave,
    t,
  ]);

  const openDeleteModal = (index: number) => {
    setTargetDeleteIndex(index);
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setTargetDeleteIndex(null);
  };

  const handleConfirmDelete = useCallback(async () => {
    if (
      targetDeleteIndex === null ||
      targetDeleteIndex < 0 ||
      targetDeleteIndex >= apiKeyItems.length
    ) {
      return;
    }
    const keyToDelete = apiKeyItems[targetDeleteIndex].apiKey;
    setSaving(true);
    try {
      const nextItems = apiKeyItems.filter((_, i) => i !== targetDeleteIndex);
      // A deleted key keeps no quota visibility, so a later key with the same value starts empty.
      const nextQuota = withQuotaCredentials(quotaKeys, keyToDelete, keyToDelete, []);
      const assertConnection = connectionGuardRef.current;
      await quotaApiKeysApi.replaceClientKeys(
        nextItems,
        sameQuotaApiKeys(quotaKeys, nextQuota) ? undefined : nextQuota,
        assertConnection
      );
      assertConnection();
      setApiKeyItems(nextItems);
      setQuotaKeys(nextQuota);
      closeDeleteModal();
      await refreshConfigAfterSave(
        assertConnection,
        nextItems.map((item) => item.apiKey)
      );
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  }, [apiKeyItems, quotaKeys, refreshConfigAfterSave, showNotification, targetDeleteIndex]);

  const modalScope = modalOpen ? resolveKeyScope(keyInput, keyScopes)?.scope : undefined;

  const deleteTargetKey =
    targetDeleteIndex !== null && targetDeleteIndex >= 0 ? apiKeys[targetDeleteIndex] : '';
  const deleteTargetName =
    targetDeleteIndex !== null && targetDeleteIndex >= 0
      ? (apiKeyItems[targetDeleteIndex]?.name ?? '')
      : '';

  return (
    <div className={styles.page}>
      {/* 顶部标题栏与全局操作 */}
      <header className={styles.header}>
        <div className={styles.headerTitleRow}>
          <div className={styles.iconBadge}>
            <IconKey size={22} />
          </div>
          <div>
            <h1 className={styles.title}>{t('api_keys_page.title')}</h1>
            <p className={styles.description}>{t('api_keys_page.description')}</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || saving}
            onClick={() => void loadKeys()}
          >
            <IconRefreshCw size={14} className={loading ? styles.spinning : ''} />
            <span>{t('api_keys_page.refresh')}</span>
          </Button>
          <Button variant="primary" size="sm" disabled={loading || saving} onClick={openAddModal}>
            <IconPlus size={16} />
            <span>{t('api_keys_page.create_key')}</span>
          </Button>
        </div>
      </header>

      {/* 指标卡片栏 */}
      <section className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <IconKey size={20} />
          </div>
          <div className={styles.metricInfo}>
            <MetricValue loading={metricsLoading}>{totalKeys}</MetricValue>
            <span className={styles.metricLabel}>{t('api_keys_page.stat_total')}</span>
            <span className={styles.metricDesc}>{t('api_keys_page.stat_total_desc')}</span>
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <IconFileText size={20} />
          </div>
          <div className={styles.metricInfo}>
            <MetricValue loading={metricsLoading}>
              {namedCount}
              <span className={styles.metricValueSuffix}>/ {totalKeys}</span>
            </MetricValue>
            <span className={styles.metricLabel}>{t('api_keys_page.stat_named')}</span>
            <span className={styles.metricDesc}>{t('api_keys_page.stat_named_desc')}</span>
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <IconShield size={20} />
          </div>
          <div className={styles.metricInfo}>
            <MetricValue loading={metricsLoading}>
              {restrictedCount}
              <span className={styles.metricValueSuffix}>/ {totalKeys}</span>
            </MetricValue>
            <span className={styles.metricLabel}>{t('api_keys_page.stat_restricted')}</span>
            <span className={styles.metricDesc}>{t('api_keys_page.stat_restricted_desc')}</span>
          </div>
        </div>
      </section>

      {/* 全局默认模型规则 */}
      <GlobalClientModelRulesCard
        rules={globalModelRules}
        loading={loading}
        disabled={saving}
        candidates={modelCatalog.candidates}
        catalogState={modelCatalog.catalogState}
        onRetryCatalog={() => void modelCatalog.retry()}
        editing={globalRulesEditing}
        onEditingChange={setGlobalRulesEditing}
        onSave={handleSaveGlobalModelRules}
      />

      {/* 工具栏 */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrapper}>
          <IconSearch size={16} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder={t('api_keys_page.search_placeholder')}
            aria-label={t('api_keys_page.search_aria')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className={styles.clearSearchBtn}
              onClick={() => setSearchQuery('')}
              type="button"
              aria-label={t('api_keys_page.clear_search')}
              title={t('api_keys_page.clear_search')}
            >
              <IconX size={14} />
            </button>
          )}
        </div>
        <div className={styles.countBadge}>
          {searchQuery ? `${filteredRows.length} / ${totalKeys}` : `${totalKeys}`}
        </div>
      </div>

      {/* 核心表格展示 */}
      <Card className={styles.tableCard}>
        {loading ? (
          <div style={{ padding: '24px' }}>
            <Skeleton height={200} />
          </div>
        ) : apiKeys.length === 0 ? (
          <div style={{ padding: '32px 16px' }}>
            <EmptyState
              title={t('api_keys_page.empty_title')}
              description={t('api_keys_page.empty_desc')}
              action={
                <Button size="sm" onClick={openAddModal}>
                  <IconPlus size={16} />
                  <span>{t('api_keys_page.create_key')}</span>
                </Button>
              }
            />
          </div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: '32px 16px' }}>
            <EmptyState
              title={t('api_keys_page.empty_search_title')}
              description={t('api_keys_page.empty_search_desc')}
              action={
                <Button variant="secondary" size="sm" onClick={() => setSearchQuery('')}>
                  <span>{t('common.reset', '重置')}</span>
                </Button>
              }
            />
          </div>
        ) : (
          <Table
            cols={
              <>
                <col style={{ minWidth: '130px', width: '14%' }} />
                <col style={{ minWidth: '220px' }} />
                <col style={{ minWidth: '240px', width: '36%' }} />
                <col style={{ width: '96px' }} />
              </>
            }
          >
            <TableHeader>
              <TableRow>
                <TableHead>{t('api_keys_page.table_name')}</TableHead>
                <TableHead>{t('api_keys_page.table_key')}</TableHead>
                <TableHead>{t('api_keys_page.table_models')}</TableHead>
                <TableHead alignRight>{t('api_keys_page.table_actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map(({ item, key, index, name }) => {
                const isRevealed = revealedKeys.has(key);
                const isCopied = copiedKey === key;
                const scope = summarizeApiKeyModelScope(
                  item,
                  DEFAULT_VISIBLE_MODEL_LIMIT,
                  globalModelRules
                );
                const providerScope = resolveKeyScope(key, keyScopes)?.scope;
                const quotaCount = quotaCredentialsForKey(quotaKeys, key).length;

                return (
                  <TableRow key={`${key}-${index}`}>
                    <TableCell>
                      {name ? (
                        <span className={styles.keyName}>{name}</span>
                      ) : (
                        <span className={styles.unnamed}>{t('api_keys_page.unnamed')}</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className={styles.keyCell}>
                        <code className={styles.keyCode} title={isRevealed ? key : undefined}>
                          {isRevealed ? key : maskApiKey(key)}
                        </code>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => toggleReveal(key)}
                          title={t(
                            isRevealed ? 'api_keys_page.hide_key' : 'api_keys_page.show_key'
                          )}
                          aria-label={t(
                            isRevealed ? 'api_keys_page.hide_key' : 'api_keys_page.show_key'
                          )}
                        >
                          {isRevealed ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => void handleCopy(key)}
                          title={t('api_keys_page.copy_key')}
                          aria-label={t('api_keys_page.copy_key')}
                        >
                          {isCopied ? (
                            <IconCheck size={15} className={styles.copiedIcon} />
                          ) : (
                            <IconCopy size={15} />
                          )}
                        </button>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className={styles.modelTagList}>
                        {scope.inheritsGlobal && (
                          <span
                            className={styles.modelInheritedTag}
                            title={t('api_keys_page.global_models.inherited_hint')}
                          >
                            {t('api_keys_page.global_models.inherited_badge')}
                          </span>
                        )}
                        {providerScope && (
                          <span
                            className={styles.providerScopeTag}
                            title={t('api_keys_page.scopes.matched_prefix', {
                              prefix: providerScope.keyPrefix,
                            })}
                          >
                            {t('api_keys_page.scopes.tag', {
                              providers: effectiveKeyScopeProviders(providerScope.providers).join(
                                ', '
                              ),
                            })}
                          </span>
                        )}
                        {quotaCount > 0 && (
                          <span className={styles.providerScopeTag}>
                            {t('api_keys_page.quota_credentials.tag', { n: quotaCount })}
                          </span>
                        )}
                        {!scope.restricted ? (
                          <span className={styles.allModelsBadge}>
                            {t('api_keys_page.all_models')}
                          </span>
                        ) : (
                          <>
                            {scope.visibleAllowed.map((model) => (
                              <span key={model} className={styles.modelTag} title={model}>
                                {model}
                              </span>
                            ))}
                            {scope.hiddenAllowedCount > 0 && (
                              <span
                                className={styles.modelMoreTag}
                                title={scope.allowed.join(', ')}
                              >
                                {t('excluded_models.chips_more', { n: scope.hiddenAllowedCount })}
                              </span>
                            )}
                          </>
                        )}
                        {scope.excluded.length > 0 && (
                          <span
                            className={styles.modelExcludedTag}
                            title={scope.excluded.join(', ')}
                          >
                            {t('api_keys_page.models_excluded_count', {
                              n: scope.excluded.length,
                            })}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell alignRight>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => openEditModal(item, index)}
                          disabled={saving}
                          title={t('api_keys_page.edit_key')}
                          aria-label={t('api_keys_page.edit_key')}
                        >
                          <IconPencil size={15} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          onClick={() => openDeleteModal(index)}
                          disabled={saving}
                          title={t('api_keys_page.delete_key')}
                          aria-label={t('api_keys_page.delete_key')}
                        >
                          <IconTrash2 size={15} />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <ClientKeyScopesCard
        scopes={keyScopes}
        providerSuggestions={providerSuggestions}
        loading={loading}
        disabled={saving}
        onSave={handleSaveScopes}
      />

      {/* 添加 / 编辑弹窗 */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={
          editingIndex !== null
            ? t('config_management.visual.api_keys.edit_title')
            : t('config_management.visual.api_keys.add_title')
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              {t('common.cancel', '取消')}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving} loading={saving}>
              {editingIndex !== null ? t('common.save', '保存') : t('common.add', '添加')}
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label htmlFor={nameInputId}>{t('config_management.visual.api_keys.name_label')}</label>
          <input
            id={nameInputId}
            className="input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder={t('config_management.visual.api_keys.name_placeholder')}
            aria-describedby={nameHintId}
            disabled={saving}
          />
          <div id={nameHintId} className="hint">
            {t('api_keys_page.name_hint')}
          </div>
        </div>

        <div className="form-group">
          <div className={styles.modalKeyHeader}>
            <label htmlFor={apiKeyInputId}>
              {t('config_management.visual.api_keys.input_label')}
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleGenerate}
              disabled={saving}
            >
              <IconRefreshCw size={12} />
              <span>{t('config_management.visual.api_keys.generate')}</span>
            </Button>
          </div>
          <div className={styles.modalInputWrapper}>
            <input
              id={apiKeyInputId}
              className="input"
              placeholder={t('config_management.visual.api_keys.input_placeholder')}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={saving}
              aria-describedby={formError ? `${apiKeyErrorId} ${apiKeyHintId}` : apiKeyHintId}
              aria-invalid={Boolean(formError)}
            />
          </div>
          <ApiKeyStrengthMeter value={keyInput} />
          <div id={apiKeyHintId} className="hint">
            {t('config_management.visual.api_keys.input_hint')}
          </div>
          {formError && (
            <div id={apiKeyErrorId} className="error-box">
              {formError}
            </div>
          )}
        </div>

        {modalScope && (
          <div className={`hint ${styles.modalScopeNote}`}>
            {t('api_keys_page.scopes.modal_note', {
              prefix: modalScope.keyPrefix,
              providers: effectiveKeyScopeProviders(modalScope.providers).join(', '),
            })}
          </div>
        )}

        <ClientKeyModelRulesField
          label={t('api_keys_page.models_label')}
          hint={t('api_keys_page.models_hint')}
          tone="allow"
          value={allowedModels}
          onChange={setAllowedModels}
          candidates={modelCatalog.candidates}
          catalogState={modelCatalog.catalogState}
          onRetry={() => void modelCatalog.retry()}
          disabled={saving}
        />

        <ClientKeyModelRulesField
          label={t('api_keys_page.excluded_models_label')}
          hint={t('api_keys_page.excluded_models_hint')}
          tone="exclude"
          value={excludedModels}
          onChange={setExcludedModels}
          candidates={modelCatalog.candidates}
          catalogState={modelCatalog.catalogState}
          onRetry={() => void modelCatalog.retry()}
          disabled={saving}
        />

        {modalOpen && (
          <ClientKeyQuotaCredentialsField
            value={quotaCredentials}
            onChange={setQuotaCredentials}
            disabled={saving}
          />
        )}
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal
        open={deleteModalOpen}
        onClose={closeDeleteModal}
        title={t('api_keys_page.delete_modal_title')}
        footer={
          <>
            <Button variant="secondary" onClick={closeDeleteModal} disabled={saving}>
              {t('common.cancel', '取消')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleConfirmDelete()}
              disabled={saving}
              loading={saving}
            >
              {t('api_keys_page.delete_btn')}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
          {t('api_keys_page.delete_modal_confirm')}
        </p>
        {deleteTargetKey && (
          <div className={styles.deleteKeyPreview}>
            <strong>{deleteTargetName || t('api_keys_page.unnamed')}</strong>
            <code>{maskApiKey(deleteTargetKey)}</code>
          </div>
        )}
      </Modal>
    </div>
  );
}
