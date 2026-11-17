import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExcludedModelsPicker,
  formatExcludedRulesText,
  parseExcludedRulesText,
  type ExcludedModelsCatalogState,
  type ModelRulesTone,
} from '@/components/excludedModels';
import { authFilesApi } from '@/services/api';
import type { AuthFileModelItem } from '@/features/authFiles/constants';

interface AuthFileExcludedModelsFieldProps {
  fileName: string;
  /** 换行分隔的规则文本——凭证编辑器的 dirty diff 依赖这个形状，不要改成数组。 */
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  /** Defaults to the excluded_models label and copy. */
  tone?: ModelRulesTone;
  label?: string;
  /**
   * Also offer this provider's static catalog. Allow-lists need it: the credential's own
   * list only contains models that are already allowed.
   */
  catalogProvider?: string;
  /** Rules match upstream IDs, so prefixed routes (`prefix/model`) are folded into the bare ID. */
  prefix?: string;
  hint?: string;
}

export function AuthFileExcludedModelsField({
  fileName,
  value,
  disabled,
  onChange,
  tone = 'exclude',
  label,
  catalogProvider,
  prefix,
  hint,
}: AuthFileExcludedModelsFieldProps) {
  const { t } = useTranslation();
  // 凭证文件名可能含点/斜杠等字符，不适合直接当 HTML id。
  const labelId = `${useId()}-excluded-models-label`;
  const latestValueRef = useRef(value);
  const [models, setModels] = useState<AuthFileModelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setLoading(true);
    setLoadFailed(false);

    const routePrefix = prefix?.trim() ? `${prefix.trim()}/` : '';
    const catalog = catalogProvider
      ? authFilesApi.getModelDefinitions(catalogProvider).catch(() => [])
      : Promise.resolve([]);
    void Promise.all([authFilesApi.getModelsForAuthFile(fileName), catalog])
      .then(([items, definitions]) => {
        if (cancelled) return;
        const byId = new Map<string, AuthFileModelItem>();
        [...items, ...definitions].forEach((item) => {
          let id = item.id?.trim();
          if (id && routePrefix && id.startsWith(routePrefix)) id = id.slice(routePrefix.length);
          if (id && !byId.has(id.toLowerCase())) byId.set(id.toLowerCase(), { ...item, id });
        });
        // 已配置但目录里没有的精确规则也塞进候选，否则它们会在列表里凭空消失。
        parseExcludedRulesText(latestValueRef.current).forEach((rule) => {
          if (!rule.includes('*') && !byId.has(rule.toLowerCase())) {
            byId.set(rule.toLowerCase(), { id: rule });
          }
        });
        setModels(
          [...byId.values()].sort((left, right) =>
            left.id.localeCompare(right.id, undefined, { sensitivity: 'base' })
          )
        );
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [catalogProvider, fileName, prefix]);

  const rules = useMemo(() => parseExcludedRulesText(value), [value]);
  const candidates = useMemo(
    () => models.map((model) => ({ id: model.id, displayName: model.display_name })),
    [models]
  );
  const catalogState: ExcludedModelsCatalogState = loading
    ? 'loading'
    : loadFailed
      ? 'error'
      : 'ready';

  return (
    <div className="form-group">
      <label id={labelId}>{label ?? t('auth_files.excluded_models_label')}</label>
      <ExcludedModelsPicker
        value={rules}
        onChange={(next) => onChange(formatExcludedRulesText(next))}
        candidates={candidates}
        catalogState={catalogState}
        disabled={disabled}
        labelledBy={labelId}
        tone={tone}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
