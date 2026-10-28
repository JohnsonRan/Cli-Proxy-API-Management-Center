/**
 * Model fingerprint detection (lmfpd) API.
 */

import { apiClient } from './client';

export type FingerprintApiFormat = 'responses' | 'chat_completions' | 'messages';

export interface FingerprintDetectRequest {
  model: string;
  api: FingerprintApiFormat;
  api_key?: string;
  effort?: string;
  no_stream?: boolean;
}

export interface FingerprintCandidate {
  model: string;
  display_name: string;
  family: string;
  family_name: string;
  score: number;
  probability: number | null;
}

export interface FingerprintAnalysis {
  decision: 'scored' | 'partial' | 'unscorable' | 'not_model' | string;
  prediction: string;
  prediction_name: string;
  family_prediction_name: string;
  results: FingerprintCandidate[];
  probability: number | null;
  used_outputs: number;
  evidence?: { label?: string; reason?: string };
}

export interface FingerprintSample {
  state: string;
  count: number;
  expected_count: number;
  first_byte_ms?: number | null;
  response_model: string | null;
  error: string | null;
}

export interface FingerprintDetectResult {
  built_at: string;
  samples: FingerprintSample[];
  analysis: FingerprintAnalysis | null;
  error: string | null;
}

export interface FingerprintStreamState {
  /** Latest snapshot per challenge index. */
  samples: FingerprintSample[];
  result: FingerprintDetectResult | null;
  error: string | null;
}

/**
 * Read the `progress` NDJSON stream: sample lines, then a result or error line. Only complete lines
 * count, so a partial body is safe to parse. A core without progress support answers one JSON object,
 * which is taken as the result.
 */
export const parseFingerprintStream = (body: unknown): FingerprintStreamState => {
  const state: FingerprintStreamState = { samples: [], result: null, error: null };
  if (body && typeof body === 'object') {
    state.result = body as FingerprintDetectResult;
    return state;
  }
  if (typeof body !== 'string') return state;
  const lines = body.split('\n');
  lines.pop(); // incomplete tail, or '' after the last newline
  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const record = event as Record<string, unknown>;
    if (record.type === 'sample' && typeof record.index === 'number' && record.sample) {
      state.samples[record.index] = record.sample as FingerprintSample;
    } else if (record.type === 'result' && record.result) {
      state.result = record.result as FingerprintDetectResult;
    } else if (record.type === 'error') {
      state.error = typeof record.error === 'string' ? record.error : 'error';
    } else if (!('type' in record) && Array.isArray(record.samples)) {
      state.result = record as unknown as FingerprintDetectResult;
    }
  }
  return state;
};

const readResponseText = (event: unknown): string | null => {
  const target = (event as { target?: unknown } | undefined)?.target;
  const text = (target as { responseText?: unknown } | undefined)?.responseText;
  return typeof text === 'string' ? text : null;
};

// Detection has no client timeout (model requests may take minutes); the caller can cancel via signal.
export const fingerprintApi = {
  detect: async (
    body: FingerprintDetectRequest,
    options: { signal?: AbortSignal; onProgress?: (samples: FingerprintSample[]) => void } = {}
  ): Promise<FingerprintDetectResult> => {
    const { signal, onProgress } = options;
    const data = await apiClient.post<unknown>(
      '/observability/fingerprint/detect',
      { ...body, progress: true },
      {
        timeout: 0,
        signal,
        // The XHR adapter exposes the growing body; the default JSON transform keeps NDJSON as text.
        onDownloadProgress: onProgress
          ? (event) => {
              const text = readResponseText(event.event);
              if (text !== null) onProgress(parseFingerprintStream(text).samples);
            }
          : undefined,
      }
    );
    // The finished body is complete, so its last line counts even without a trailing newline.
    const state = parseFingerprintStream(typeof data === 'string' ? `${data}\n` : data);
    if (state.result) return state.result;
    throw new Error(state.error || 'Detection ended without a result');
  },
};
