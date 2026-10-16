import { isQuotaApiProvider } from '@/services/api/quotaApiKeys';
import type { AuthFileItem } from '@/types/authFile';

export interface QuotaCredentialOption {
  /** Core auth ID, the value stored in quota-api.keys. */
  id: string;
  label: string;
  provider: string;
  disabled: boolean;
  /** Selected but no longer among the credentials. */
  missing: boolean;
}

/**
 * Options for the credentials whose quota core's GET /v1/usage can read. Core probes only
 * OAuth credentials (`account_type` is core's AuthKind), so API-key credentials of the same
 * providers are left out. Saved IDs that no longer match a credential keep a row so they can
 * be cleared instead of lingering.
 */
export const buildQuotaCredentialOptions = (
  files: readonly AuthFileItem[],
  selected: readonly string[]
): QuotaCredentialOption[] => {
  const byId = new Map<string, QuotaCredentialOption>();
  files.forEach((file) => {
    const provider = String(file.provider ?? file.type ?? '')
      .trim()
      .toLowerCase();
    if (!isQuotaApiProvider(provider) || file['account_type'] !== 'oauth') return;
    const id = String(file['id'] ?? file.name ?? '').trim();
    if (!id || byId.has(id)) return;
    const name = String(file.name ?? id).trim() || id;
    const note = typeof file.note === 'string' ? file.note.trim() : '';
    byId.set(id, {
      id,
      label: note ? `${note} · ${name}` : name,
      provider,
      disabled: file.disabled === true,
      missing: false,
    });
  });
  selected.forEach((id) => {
    if (!byId.has(id))
      byId.set(id, { id, label: id, provider: '', disabled: false, missing: true });
  });
  return [...byId.values()].sort(
    (left, right) =>
      Number(left.missing) - Number(right.missing) ||
      left.provider.localeCompare(right.provider) ||
      left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
  );
};
