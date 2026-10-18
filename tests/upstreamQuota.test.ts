import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import {
  buildUpstreamQuotaUrl,
  lowestRemainingPercent,
  normalizeUpstreamQuota,
} from '@/features/providers/upstreamQuota';
import { QUOTA_RELAY_PROVIDER } from '@/utils/constants';
import { UpstreamQuotaResultView } from '@/features/providers/sheets/UpstreamQuotaPanel';

// A GET /v1/usage body as the core returns it: one relay whose upstream shares two accounts.
const RELAYED = {
  version: 2,
  credentials: [
    {
      name: 'friend',
      provider: 'relay',
      status: 'ok',
      observed_at: '2026-10-18T03:00:00Z',
      windows: [],
      upstream: [
        {
          name: 'team-a',
          provider: 'codex',
          status: 'ok',
          plan: 'team',
          windows: [
            {
              id: 'five_hour',
              used_percent: 80,
              reset_at: '2026-10-18T05:00:00Z',
              period_seconds: 18000,
            },
            { id: 'weekly', used_percent: 30, period_seconds: 604800 },
          ],
          balances: [{ id: 'credits', remaining: 12.5, unit: 'credits' }],
        },
        { name: 'team-b', provider: 'codex', status: 'error', error: 'auth token refresh failed' },
      ],
    },
  ],
};

describe('upstream quota', () => {
  test('builds the quota URL from OpenAI- and Claude-style base URLs', () => {
    expect(buildUpstreamQuotaUrl('https://up.example/v1')).toBe('https://up.example/v1/usage');
    expect(buildUpstreamQuotaUrl('https://up.example/v1/')).toBe('https://up.example/v1/usage');
    expect(buildUpstreamQuotaUrl('https://up.example')).toBe('https://up.example/v1/usage');
    expect(buildUpstreamQuotaUrl('http://10.0.0.2:8317/proxy/v1?x=1')).toBe(
      'http://10.0.0.2:8317/proxy/v1/usage'
    );
    expect(buildUpstreamQuotaUrl('')).toBeNull();
    expect(buildUpstreamQuotaUrl('ftp://up.example')).toBeNull();
  });

  test('accepts only the CLIProxyAPI quota contract', () => {
    expect(normalizeUpstreamQuota({ object: 'list', data: [] })).toBeNull();
    expect(normalizeUpstreamQuota('<html>')).toBeNull();
    expect(normalizeUpstreamQuota('{"credentials":[]}')).toBeNull();
    expect(normalizeUpstreamQuota({ credentials: [] })).toBeNull();
    expect(normalizeUpstreamQuota({ version: 1, credentials: [] })).toBeNull();
    expect(normalizeUpstreamQuota({ version: 2, credentials: [] })).toEqual([]);
    expect(QUOTA_RELAY_PROVIDER).toBe('relay');

    const credentials = normalizeUpstreamQuota(RELAYED);
    expect(credentials).not.toBeNull();
    const relay = credentials![0];
    expect(relay.provider).toBe(QUOTA_RELAY_PROVIDER);
    expect(relay.upstream).toHaveLength(2);
    expect(relay.upstream[0].windows[0]).toEqual({
      id: 'five_hour',
      label: null,
      usedPercent: 80,
      resetAt: '2026-10-18T05:00:00Z',
      periodSeconds: 18000,
    });
    expect(relay.upstream[1]).toMatchObject({ status: 'error', windows: [], balances: [] });
  });

  test('the tightest window across nested accounts sets the headline', () => {
    const credentials = normalizeUpstreamQuota(RELAYED)!;
    expect(lowestRemainingPercent(credentials[0])).toBe(20);
    expect(lowestRemainingPercent(credentials[0].upstream[1])).toBeNull();
  });

  test('renders every account collapsible, nested under its relay', () => {
    const markup = renderToStaticMarkup(
      createElement(UpstreamQuotaResultView, {
        result: { ok: true, credentials: normalizeUpstreamQuota(RELAYED)! },
      })
    );
    expect(markup.match(/<details/g)).toHaveLength(3);
    expect(markup).toContain('team-a');
    expect(markup).toContain(i18n.t('providersPage.upstreamQuota.relay'));
    expect(markup).toContain(i18n.t('providersPage.upstreamQuota.windows.five_hour'));
    expect(markup).toContain(
      i18n.t('providersPage.upstreamQuota.remainingPercent', { percent: 20 })
    );
    expect(markup).toContain('auth token refresh failed');
    expect(markup).toContain('width:20%');
  });

  test('explains an upstream without the endpoint', () => {
    const markup = renderToStaticMarkup(
      createElement(UpstreamQuotaResultView, {
        result: { ok: false, reason: 'unsupported', message: '' },
      })
    );
    expect(markup).toContain(i18n.t('providersPage.upstreamQuota.unsupported'));
  });
});
