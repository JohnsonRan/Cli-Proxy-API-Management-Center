/**
 * 手动回调输入 → 提交给后端的 redirect_url。
 *
 * 只有 xAI 需要拼装：Grok 有时只在页面显示 code，此时用本次登录的 state
 * 拼回固定的回环地址。其余提供商原样提交（Devin 另有严格校验，见 devinOAuth.ts）。
 *
 * Command Code 也需要拼装：Studio 以 POST 表单把 apiKey/state 发到回环地址，
 * 地址栏里只剩不带参数的 /callback。允许粘贴带参数的地址、请求载荷原文
 * （apiKey=…&state=… 或 JSON）或单独的 API Key，统一拼成带参数的回调地址。
 */

export const XAI_CALLBACK_URL = 'http://127.0.0.1:56121/callback';
export const COMMANDCODE_CALLBACK_URL = 'http://127.0.0.1:54546/callback';

const COMMANDCODE_FIELDS = ['apiKey', 'state', 'error', 'error_description'] as const;

// 只认 http(s)：`code: xyz` 这类页面展示文本也能被 URL 解析（`code:` 是合法 scheme）。
const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const readQueryLikeCallbackInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const queryStart = trimmed.indexOf('?');
  const hashStart = trimmed.indexOf('#');
  const rawParams =
    queryStart >= 0
      ? trimmed.slice(queryStart + 1)
      : hashStart >= 0
        ? trimmed.slice(hashStart + 1)
        : trimmed;

  if (!/(^|[&#?])(code|state|error)=/i.test(rawParams)) return null;
  return new URLSearchParams(rawParams.replace(/^[?#]/, ''));
};

const extractDisplayedXaiCode = (value: string): string => {
  const trimmed = value.trim();
  const codeMatch = trimmed.match(/\bcode\s*[:=]\s*([^\s&]+)/i);
  return (codeMatch?.[1] ?? trimmed).trim();
};

const buildXaiCallbackUrl = (input: string, state?: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isAbsoluteHttpUrl(trimmed)) return trimmed;

  const params = readQueryLikeCallbackInput(trimmed);
  if (params) {
    const code = params.get('code')?.trim();
    const error = params.get('error')?.trim();
    const errorDescription = params.get('error_description')?.trim();
    const callbackState = params.get('state')?.trim() || state?.trim();
    if (!callbackState) return null;

    const callbackUrl = new URL(XAI_CALLBACK_URL);
    callbackUrl.searchParams.set('state', callbackState);
    if (code) callbackUrl.searchParams.set('code', code);
    if (error) callbackUrl.searchParams.set('error', error);
    if (errorDescription) callbackUrl.searchParams.set('error_description', errorDescription);
    return callbackUrl.toString();
  }

  const code = extractDisplayedXaiCode(trimmed);
  const callbackState = state?.trim();
  if (!code || !callbackState) return null;

  const callbackUrl = new URL(XAI_CALLBACK_URL);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', callbackState);
  return callbackUrl.toString();
};

const readCommandCodeFields = (input: string): Map<string, string> | null => {
  const fields = new Map<string, string>();
  const take = (key: string, value: unknown) => {
    if ((COMMANDCODE_FIELDS as readonly string[]).includes(key) && typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) fields.set(key, trimmed);
    }
  };

  if (input.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(input);
      if (!parsed || typeof parsed !== 'object') return null;
      Object.entries(parsed).forEach(([key, value]) => take(key, value));
      return fields;
    } catch {
      return null;
    }
  }

  if (isAbsoluteHttpUrl(input)) {
    new URL(input).searchParams.forEach((value, key) => take(key, value));
    return fields;
  }

  if (input.includes('=')) {
    const queryStart = input.indexOf('?');
    new URLSearchParams(queryStart >= 0 ? input.slice(queryStart + 1) : input).forEach(
      (value, key) => take(key, value)
    );
    return fields;
  }

  if (/^\S+$/.test(input)) {
    fields.set('apiKey', input);
    return fields;
  }
  return null;
};

const buildCommandCodeCallbackUrl = (input: string, state?: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fields = readCommandCodeFields(trimmed);
  if (!fields) return null;
  const callbackState = fields.get('state') || state?.trim();
  if (!callbackState || (!fields.get('apiKey') && !fields.get('error'))) return null;

  const callbackUrl = new URL(COMMANDCODE_CALLBACK_URL);
  callbackUrl.searchParams.set('state', callbackState);
  COMMANDCODE_FIELDS.forEach((key) => {
    const value = fields.get(key);
    if (value && key !== 'state') callbackUrl.searchParams.set(key, value);
  });
  return callbackUrl.toString();
};

export const resolveCallbackUrl = (
  provider: string,
  input: string,
  state?: string
): string | null => {
  if (provider === 'xai') return buildXaiCallbackUrl(input, state);
  if (provider === 'commandcode') return buildCommandCodeCallbackUrl(input, state);
  return input.trim();
};
