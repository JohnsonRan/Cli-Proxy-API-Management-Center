import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export type ModelRulesTone = 'exclude' | 'allow';

export type ModelRulesCopy = (
  key: string,
  options?: Record<string, string | number>
) => string;

/** Allow-lists reuse the exclude picker. Only the strings that say "excluded" change. */
export function useModelRulesCopy(tone: ModelRulesTone = 'exclude'): ModelRulesCopy {
  const { t } = useTranslation();
  return useCallback(
    (key, options) => {
      if (tone === 'allow') {
        const fallback = t(`excluded_models.${key}`, options);
        return t(`model_rules.allow.${key}`, { ...options, defaultValue: fallback });
      }
      return t(`excluded_models.${key}`, options);
    },
    [t, tone]
  );
}
