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

// Detection has no client timeout (model requests may take minutes); the caller can cancel via signal.
export const fingerprintApi = {
  detect: (body: FingerprintDetectRequest, signal?: AbortSignal) =>
    apiClient.post<FingerprintDetectResult>('/observability/fingerprint/detect', body, {
      timeout: 0,
      signal,
    }),
};
