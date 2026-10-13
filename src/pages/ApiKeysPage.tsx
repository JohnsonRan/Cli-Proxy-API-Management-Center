import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
  apiKeyNameFingerprint,
  readApiKeyNames,
  saveApiKeyName,
} from '@/features/config/apiKeyNames';
import {
  normalizeExcludedRules,
  type ExcludedModelCandidate,
  type ExcludedModelsCatalogState,
} from '@/components/excludedModels';
import { apiKeysApi, ClientApiKeyItem } from '@/services/api/apiKeys';
import { modelsApi } from '@/services/api/models';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { ClientKeyModelRulesField } from './ClientKeyModelRulesField';

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
import { evaluateApiKeyStrength } from '@/utils/apiKeyStrength';
import { copyToClipboard } from '@/utils/clipboard';
import { maskApiKey } from '@/utils/format';
import { getErrorMessage } from '@/utils/helpers';
import { isValidApiKeyCharset } from '@/utils/validation';
import styles from './ApiKeysPage.module.scss';

export function ApiKeysPage() {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const [apiKeyItems, setApiKeyItems] = useState<ClientApiKeyItem[]>([]);
  const apiKeys = useMemo(() => apiKeyItems.map((item) => item.apiKey), [apiKeyItems]);
  const [names, setNames] = useState<Record<string, string>>(() => readApiKeyNames(apiBase));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Search & interaction states
  const [searchQuery, setSearchQuery] = useState('');
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(() => new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Add / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [excludedModels, setExcludedModels] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const modelCatalog = useProxyModelCatalog(modalOpen);

  // Delete Modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [targetDeleteIndex, setTargetDeleteIndex] = useState<number | null>(null);

  const nameInputId = useId();
  const apiKeyInputId = useId();
  const nameHintId = `${nameInputId}-hint`;
  const apiKeyHintId = `${apiKeyInputId}-hint`;
  const apiKeyErrorId = `${apiKeyInputId}-error`;

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const items = await apiKeysApi.listItems();
      setApiKeyItems(items);
      setNames(readApiKeyNames(apiBase));
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [apiBase, showNotification]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  // Compute metrics
  const totalKeys = apiKeys.length;
  const namedCount = useMemo(() => {
    return apiKeys.filter((k) => !!names[apiKeyNameFingerprint(apiBase, k)]).length;
  }, [apiBase, apiKeys, names]);

  const strongCount = useMemo(() => {
    return apiKeys.filter((k) => {
      const { tier } = evaluateApiKeyStrength(k);
      return tier === 'strong' || tier === 'good';
    }).length;
  }, [apiKeys]);

  const complianceRate = useMemo(() => {
    if (totalKeys === 0) return '100%';
    return `${Math.round((strongCount / totalKeys) * 100)}%`;
  }, [strongCount, totalKeys]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = apiKeyItems.map((item, index) => {
      const key = item.apiKey;
      const name = names[apiKeyNameFingerprint(apiBase, key)] || '';
      return { item, key, index, name };
    });

    if (!q) return rows;
    return rows.filter(({ key, name }) => {
      return name.toLowerCase().includes(q) || key.toLowerCase().includes(q);
    });
  }, [apiBase, apiKeyItems, names, searchQuery]);

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
      if (copied) {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1500);
        showNotification(t('api_keys_page.copied', '已复制'), 'success');
      } else {
        showNotification(t('notification.copy_failed', '复制失败'), 'error');
      }
    },
    [showNotification, t]
  );

  const openAddModal = () => {
    setEditingIndex(null);
    setNameInput('');
    setKeyInput('');
    setAllowedModels([]);
    setExcludedModels([]);
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (item: ClientApiKeyItem, index: number) => {
    const latestNames = readApiKeyNames(apiBase);
    setNames(latestNames);
    setEditingIndex(index);
    setNameInput(latestNames[apiKeyNameFingerprint(apiBase, item.apiKey)] ?? '');
    setKeyInput(item.apiKey);
    const activeModels = item.models ?? item.allowedModels ?? [];
    setAllowedModels(normalizeExcludedRules(activeModels));
    setExcludedModels(normalizeExcludedRules(item.excludedModels ?? []));
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
    setFormError('');
  };

  const handleGenerate = () => {
    setKeyInput(generateSecureApiKey());
    setFormError('');
  };

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
      models: allowedModels.length > 0 ? allowedModels : undefined,
      excludedModels: excludedModels.length > 0 ? excludedModels : undefined,
    };

    setSaving(true);
    try {
      let nextItems: ClientApiKeyItem[];
      if (editingIndex !== null && editingIndex >= 0) {
        const oldKey = apiKeyItems[editingIndex].apiKey;
        nextItems = apiKeyItems.map((k, i) => (i === editingIndex ? nextItem : k));
        if (oldKey !== trimmedKey) {
          saveApiKeyName(apiBase, oldKey, '');
        }
      } else {
        nextItems = [...apiKeyItems, nextItem];
      }

      if (!saveApiKeyName(apiBase, trimmedKey, nameInput)) {
        setFormError(t('config_management.visual.api_keys.name_save_error'));
        setSaving(false);
        return;
      }

      await apiKeysApi.replaceItems(nextItems);
      await fetchConfig(true);
      setApiKeyItems(nextItems);
      setNames(readApiKeyNames(apiBase));
      closeModal();
      showNotification(t('common.saved_success', '保存成功'), 'success');
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [allowedModels, apiBase, apiKeyItems, editingIndex, excludedModels, fetchConfig, keyInput, nameInput, showNotification, t]);

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
      saveApiKeyName(apiBase, keyToDelete, '');
      await apiKeysApi.replaceItems(nextItems);
      await fetchConfig(true);
      setApiKeyItems(nextItems);
      setNames(readApiKeyNames(apiBase));
      closeDeleteModal();
      showNotification(t('common.saved_success', '保存成功'), 'success');
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  }, [apiBase, apiKeyItems, fetchConfig, showNotification, t, targetDeleteIndex]);

  const deleteTargetKey =
    targetDeleteIndex !== null && targetDeleteIndex >= 0 ? apiKeys[targetDeleteIndex] : '';
  const deleteTargetName =
    deleteTargetKey ? names[apiKeyNameFingerprint(apiBase, deleteTargetKey)] : '';

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
          <Button
            variant="primary"
            size="sm"
            disabled={loading || saving}
            onClick={openAddModal}
          >
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
            <span className={styles.metricValue}>{totalKeys}</span>
            <span className={styles.metricLabel}>{t('api_keys_page.stat_total')}</span>
            <span className={styles.metricDesc}>{t('api_keys_page.stat_total_desc')}</span>
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <IconFileText size={20} />
          </div>
          <div className={styles.metricInfo}>
            <span className={styles.metricValue}>
              {namedCount}
              <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                / {totalKeys}
              </span>
            </span>
            <span className={styles.metricLabel}>{t('api_keys_page.stat_named')}</span>
            <span className={styles.metricDesc}>{t('api_keys_page.stat_named_desc')}</span>
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <IconShield size={20} />
          </div>
          <div className={styles.metricInfo}>
            <span className={styles.metricValue}>{complianceRate}</span>
            <span className={styles.metricLabel}>{t('api_keys_page.stat_security')}</span>
            <span className={styles.metricDesc}>{t('api_keys_page.stat_security_desc')}</span>
          </div>
        </div>
      </section>

      {/* 工具栏 */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrapper}>
          <IconSearch size={16} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder={t('api_keys_page.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className={styles.clearSearchBtn}
              onClick={() => setSearchQuery('')}
              type="button"
            >
              <IconX size={14} />
            </button>
          )}
        </div>
        <div className={styles.countBadge}>
          {searchQuery
            ? `${filteredRows.length} / ${totalKeys}`
            : `${totalKeys}`}
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
                <col style={{ width: '56px' }} />
                <col style={{ minWidth: '130px', width: '18%' }} />
                <col style={{ minWidth: '220px' }} />
                <col style={{ minWidth: '150px', width: '22%' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '130px' }} />
              </>
            }
          >
            <TableHeader>
              <TableRow>
                <TableHead>{t('api_keys_page.table_index')}</TableHead>
                <TableHead>{t('api_keys_page.table_name')}</TableHead>
                <TableHead>{t('api_keys_page.table_key')}</TableHead>
                <TableHead>{t('api_keys_page.table_models')}</TableHead>
                <TableHead>{t('api_keys_page.table_strength')}</TableHead>
                <TableHead alignRight>{t('api_keys_page.table_actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map(({ item, key, index, name }) => {
                const isRevealed = revealedKeys.has(key);
                const isCopied = copiedKey === key;
                const { tier } = evaluateApiKeyStrength(key);
                const activeModels = item.models ?? item.allowedModels ?? [];
                const activeExcluded = item.excludedModels ?? [];

                return (
                  <TableRow key={`${key}-${index}`}>
                    <TableCell>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                        #{index + 1}
                      </span>
                    </TableCell>

                    <TableCell>
                      {name ? (
                        <span className={styles.keyName}>{name}</span>
                      ) : (
                        <span className={styles.unnamed}>{t('api_keys_page.unnamed')}</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className={styles.keyCell}>
                        <code className={styles.keyCode}>
                          {isRevealed ? key : maskApiKey(key)}
                        </code>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => toggleReveal(key)}
                          title={t(isRevealed ? 'api_keys_page.hide_key' : 'api_keys_page.show_key')}
                        >
                          {isRevealed ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => void handleCopy(key)}
                          title={t('api_keys_page.copy_key')}
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
                      {activeModels.length > 0 ? (
                        <div className={styles.modelTagList}>
                          {activeModels.map((m) => (
                            <span key={m} className={styles.modelTag}>
                              {m}
                            </span>
                          ))}
                          {activeExcluded.length > 0 && (
                            <span
                              className={styles.modelExcludedTag}
                              title={`Excluded: ${activeExcluded.join(', ')}`}
                            >
                              -{activeExcluded.length}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className={styles.allModelsBadge}>
                          {t('api_keys_page.all_models')}
                        </span>
                      )}
                    </TableCell>

                    <TableCell>
                      <span className={`${styles.strengthBadge} ${styles[tier]}`}>
                        <span className={styles.strengthDot} />
                        {t(`config_management.visual.api_keys.strength.${tier}`)}
                      </span>
                    </TableCell>

                    <TableCell alignRight>
                      <div className={styles.rowActions}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(item, index)}
                          disabled={saving}
                          title={t('api_keys_page.edit_key')}
                        >
                          <IconPencil size={14} />
                          <span>{t('common.edit', '编辑')}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={styles.deleteBtn}
                          onClick={() => openDeleteModal(index)}
                          disabled={saving}
                          title={t('api_keys_page.delete_key')}
                        >
                          <IconTrash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

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
              {editingIndex !== null
                ? t('common.save', '保存')
                : t('common.add', '添加')}
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
            {t('config_management.visual.api_keys.name_hint')}
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
