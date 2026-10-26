/**
 * 版本相关 API
 */

import { apiClient } from './client';

export interface PanelUpdateResult {
  status: string;
  updated: boolean;
  message: string;
}

export const versionApi = {
  checkLatest: () => apiClient.get<Record<string, unknown>>('/server/latest-version'),
  updatePanel: () => apiClient.post<PanelUpdateResult>('/server/update-panel'),
};
