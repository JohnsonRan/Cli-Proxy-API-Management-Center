import iconClaude from '@/assets/icons/claude.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconDevinDark from '@/assets/icons/devin-dark.svg';
import iconDevinLight from '@/assets/icons/devin.svg';
import iconGemini from '@/assets/icons/gemini.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconGrokLight from '@/assets/icons/grok.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconMeta from '@/assets/icons/meta.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import iconOpenAIDark from '@/assets/icons/openai-dark.svg';
import iconOpenAILight from '@/assets/icons/openai-light.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconStepfunDark from '@/assets/icons/stepfun-dark.svg';
import iconStepfunLight from '@/assets/icons/stepfun.svg';
import iconXiaomi from '@/assets/icons/xiaomi.svg';
import { getAuthFileIcon } from '@/features/authFiles/constants';
import type { ResolvedTheme } from '@/types';
import {
  matchUsageModelBrand,
  providerDisplay,
  resolveCompatFaviconUrl,
  type UsageModelBrand,
} from './logic';

const MODEL_BRAND_ICONS: Record<UsageModelBrand, string | { light: string; dark: string }> = {
  devin: { light: iconDevinLight, dark: iconDevinDark },
  meta: iconMeta,
  gpt: { light: iconOpenAILight, dark: iconOpenAIDark },
  claude: iconClaude,
  gemini: iconGemini,
  kimi: { light: iconKimiDark, dark: iconKimiLight },
  qwen: iconQwen,
  glm: iconGlm,
  grok: { light: iconGrokLight, dark: iconGrokDark },
  deepseek: iconDeepseek,
  minimax: iconMinimax,
  xiaomi: iconXiaomi,
  stepfun: { light: iconStepfunLight, dark: iconStepfunDark },
};

const getModelBrandIcon = (brand: UsageModelBrand, resolvedTheme: ResolvedTheme): string => {
  const entry = MODEL_BRAND_ICONS[brand];
  if (typeof entry === 'string') return entry;
  return resolvedTheme === 'dark' ? entry.dark : entry.light;
};

/**
 * Resolves the icon for a usage provider badge: OAuth/native providers use their auth-file
 * icon, while OpenAI-compatible upstreams infer a bundled model-family icon from the model
 * (or provider name), falling back to a public upstream faviconV2 URL and finally OpenAI.
 */
export const resolveProviderBadgeIcon = ({
  provider,
  model,
  fallbackModel,
  resolvedTheme,
  compatBaseUrl,
}: {
  provider: string;
  model?: string;
  fallbackModel?: string;
  resolvedTheme: ResolvedTheme;
  compatBaseUrl?: string;
}): { src: string | null; fallbackSrc: string | null } => {
  const display = providerDisplay(provider);
  if (!display.compat) {
    return { src: getAuthFileIcon(display.type, resolvedTheme), fallbackSrc: null };
  }
  const openaiFallback = resolvedTheme === 'dark' ? iconOpenAIDark : iconOpenAILight;
  const brand =
    matchUsageModelBrand(model) ??
    matchUsageModelBrand(fallbackModel) ??
    matchUsageModelBrand(display.name);
  if (brand) {
    return {
      src: getModelBrandIcon(brand, resolvedTheme),
      fallbackSrc: brand === 'gpt' ? null : openaiFallback,
    };
  }
  const faviconUrl = resolveCompatFaviconUrl(compatBaseUrl);
  if (faviconUrl) {
    return { src: faviconUrl, fallbackSrc: openaiFallback };
  }
  return { src: openaiFallback, fallbackSrc: null };
};
