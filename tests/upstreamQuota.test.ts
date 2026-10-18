import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import {
  buildUpstreamQuotaUrl,
  collectUpstreamQuotaProviders,
  collectUpstreamQuotaTargets,
  lowestRemainingPercent,
  normalizeUpstreamQuota,
} from '@/features/providers/upstreamQuota';
import { claudeToResource, codexToResource, openaiToResource } from '@/features/providers/adapters';
import { buildProviderGroups } from '@/features/providers/useProviderWorkbench';
import { UpstreamQuotaSectionView } from '@/features/quota/components/UpstreamQuotaSection';
import type { Config } from '@/types';
import { maskApiKey } from '@/utils/format';
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

  test('targets only keys with a custom base URL and an auth index, once per index', () => {
    expect(
      collectUpstreamQuotaTargets(codexToResource({ apiKey: 'sk-official', authIndex: 'a1' }, 0))
    ).toEqual([]);
    expect(
      collectUpstreamQuotaTargets(
        claudeToResource({ apiKey: 'sk-relay', baseUrl: 'https://up.example' }, 0)
      )
    ).toEqual([]);
    expect(
      collectUpstreamQuotaTargets(
        codexToResource(
          { apiKey: 'sk-friend-key-0001', baseUrl: ' https://up.example/v1 ', authIndex: 'c1' },
          0
        )
      )
    ).toEqual([
      {
        authIndex: 'c1',
        baseUrl: 'https://up.example/v1',
        maskedKey: maskApiKey('sk-friend-key-0001'),
      },
    ]);

    const openai = openaiToResource(
      {
        name: 'friend',
        baseUrl: 'https://up.example/v1',
        authIndex: 'provider-level',
        apiKeyEntries: [
          { apiKey: 'sk-entry-one-0001', authIndex: 'o1' },
          { apiKey: 'sk-entry-dup-0002', authIndex: 'o1' },
          { apiKey: 'sk-entry-none-0003' },
          { apiKey: 'sk-entry-two-0004', authIndex: 'o2' },
        ],
      },
      0
    );
    expect(collectUpstreamQuotaTargets(openai).map((target) => target.authIndex)).toEqual([
      'o1',
      'o2',
    ]);
    expect(collectUpstreamQuotaTargets(openai)[1].maskedKey).toBe(maskApiKey('sk-entry-two-0004'));
  });

  test('lists every provider that can check an upstream, across brands', () => {
    const config = {
      codexApiKeys: [
        { apiKey: 'sk-codex-official', authIndex: 'c0' },
        { apiKey: 'sk-codex-relay-01', baseUrl: 'https://a.example', authIndex: 'c1' },
      ],
      openaiCompatibility: [
        {
          name: 'friend',
          baseUrl: 'https://b.example/v1',
          apiKeyEntries: [{ apiKey: 'sk-openai-relay-1', authIndex: 'o1' }],
        },
      ],
    } as Config;
    const providers = collectUpstreamQuotaProviders(buildProviderGroups(config));
    expect(providers.map(({ resource }) => resource.brand)).toEqual([
      'codex',
      'openaiCompatibility',
    ]);
    expect(providers.flatMap(({ targets }) => targets.map((target) => target.authIndex))).toEqual([
      'c1',
      'o1',
    ]);
  });

  test('the quota page lists each relay key without requesting anything', () => {
    const config = {
      codexApiKeys: [
        { apiKey: 'sk-codex-relay-01', baseUrl: 'https://a.example', authIndex: 'c1' },
      ],
      openaiCompatibility: [
        {
          name: 'friend',
          baseUrl: 'https://b.example/v1',
          apiKeyEntries: [{ apiKey: 'sk-openai-relay-1', authIndex: 'o1' }],
        },
      ],
    } as Config;
    const render = (value: Config | null) =>
      renderToStaticMarkup(
        createElement(UpstreamQuotaSectionView, { config: value, connectionKey: 'http://cpa' })
      );
    const markup = render(config);
    expect(markup).toContain(i18n.t('quota_management.upstream_title'));
    // One idle panel per key: a check button each, no result rendered yet.
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).toContain(i18n.t('providersPage.upstreamQuota.check'));
    expect(markup).not.toContain('<details');
    expect(markup).toContain(
      [
        i18n.t('providersPage.providerNames.openaiCompatibility'),
        'friend',
        maskApiKey('sk-openai-relay-1'),
      ].join(' · ')
    );

    expect(render({ codexApiKeys: [{ apiKey: 'sk-official' }] } as Config)).toBe('');
    expect(render(null)).toBe('');
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
