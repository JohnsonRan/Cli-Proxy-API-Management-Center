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
  response_model: string | null;
  error: string | null;
}

export interface FingerprintDetectResult {
  built_at: string;
  samples: FingerprintSample[];
  analysis: FingerprintAnalysis | null;
  error: string | null;
}

// A round waits for up to three full model replies of about 300 numbers each.
const DETECT_TIMEOUT_MS = 10 * 60 * 1000;

export const fingerprintApi = {
  detect: (body: FingerprintDetectRequest, signal?: AbortSignal) =>
    apiClient.post<FingerprintDetectResult>('/observability/fingerprint/detect', body, {
      timeout: DETECT_TIMEOUT_MS,
      signal,
    }),
};
