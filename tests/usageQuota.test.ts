import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { normalizeUsageStats } from '@/services/api/usageStore';
import { CredentialQuotaCell } from '@/features/usage/components/CredentialQuotaCell';
import { sortRows } from '@/features/usage/logic';
import {
  collectCredentialQuotaTargets,
  credentialNamesByAuthIndex,
  indexQuotaEntriesByAuthIndex,
  readCachedQuota,
  resolveUsageQuotaEntry,
  summarizeCredentialQuota,
} from '@/features/usage/quota';
import { OverviewTab } from '@/features/usage/tabs/OverviewTab';
import type { QuotaCardState } from '@/features/quota/providers';
import type { QuotaStore } from '@/features/quota/providers/types';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

const NOW = new Date(2026, 7, 2, 12, 0, 0).getTime();

const makeFile = (overrides: Partial<AuthFileItem> & { name: string }): AuthFileItem =>
  ({
    type: 'codex',
    provider: 'codex',
    ...overrides,
  }) as AuthFileItem;

describe('tightest-window quota summary', () => {
  test('picks the tightest Codex window and pairs its own reset instant', () => {
    const fiveHourTighter = {
      status: 'success',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          usedPercent: 38,
          resetAtMs: NOW + 2 * HOUR_MS,
          periodHours: 5,
        },
        {
          id: 'weekly',
          label: 'Weekly limit',
          usedPercent: 15,
          resetAtMs: NOW + 5 * DAY_MS,
          periodHours: 168,
        },
      ],
    } as unknown as QuotaCardState;

    expect(summarizeCredentialQuota('codex', fiveHourTighter, NOW, 'codex-a.json')).toEqual({
      status: 'success',
      remaining: 62,
      windowLabel: '5-hour limit',
      resetAtMs: NOW + 2 * HOUR_MS,
      tone: 'medium',
      low: false,
      resetUrgent: false,
    });

    const weeklyTighter = {
      status: 'success',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          usedPercent: 10,
          resetAtMs: NOW + 2 * HOUR_MS,
          periodHours: 5,
        },
        {
          id: 'weekly',
          label: 'Weekly limit',
          usedPercent: 92,
          resetAtMs: NOW + 5 * DAY_MS,
          periodHours: 168,
        },
      ],
    } as unknown as QuotaCardState;

    expect(summarizeCredentialQuota('codex', weeklyTighter, NOW, 'codex-a.json')).toEqual({
      status: 'success',
      remaining: 8,
      windowLabel: 'Weekly limit',
      resetAtMs: NOW + 5 * DAY_MS,
      tone: 'low',
      low: true,
      resetUrgent: false,
    });
  });

  test('summarizes Claude windows with urgent final-hour reset even when dollar balances exist', () => {
    const claudeQuota = {
      status: 'success',
      windows: [
        {
          id: 'five_hour',
          label: '5h',
          usedPercent: 91,
          resetAtMs: NOW + 41 * MINUTE_MS,
          periodHours: 5,
        },
        {
          id: 'seven_day',
          label: '7d',
          usedPercent: 40,
          resetAtMs: NOW + 4 * DAY_MS,
          periodHours: 168,
        },
      ],
      dollarWindows: [
        {
          key: 'iguana_necktie',
          resetsAt: new Date(NOW + DAY_MS).toISOString(),
        },
      ],
    } as unknown as QuotaCardState;

    expect(summarizeCredentialQuota('claude', claudeQuota, NOW, 'claude.json')).toEqual({
      status: 'success',
      remaining: 9,
      windowLabel: '5h',
      resetAtMs: NOW + 41 * MINUTE_MS,
      tone: 'low',
      low: true,
      resetUrgent: true,
    });
  });

  test('flattens Antigravity model buckets and selects the lowest remaining fraction', () => {
    const antigravityQuota = {
      status: 'success',
      groups: [
        {
          id: 'gemini',
          label: 'Gemini',
          buckets: [
            {
              id: 'flash',
              label: 'Gemini Flash',
              remainingFraction: 0.85,
              resetAtMs: NOW + 3 * HOUR_MS,
              periodHours: 5,
            },
          ],
        },
        {
          id: 'claude',
          label: 'Claude',
          buckets: [
            {
              id: 'sonnet',
              label: 'Claude Sonnet',
              remainingFraction: 0.15,
              resetAtMs: NOW + 4 * HOUR_MS,
              periodHours: 5,
            },
          ],
        },
      ],
    } as unknown as QuotaCardState;

    expect(summarizeCredentialQuota('antigravity', antigravityQuota, NOW, 'ag.json')).toMatchObject(
      {
        status: 'success',
        remaining: 15,
        windowLabel: 'Claude Sonnet',
        resetAtMs: NOW + 4 * HOUR_MS,
        tone: 'low',
        low: true,
      }
    );
  });

  test('handles Devin, Kimi, Meta and xAI weekly vs monthly states', () => {
    const devin = summarizeCredentialQuota(
      'devin',
      {
        status: 'success',
        windows: [
          {
            id: 'daily',
            label: 'Daily',
            remainingPercent: 25,
            resetAtMs: NOW + 6 * HOUR_MS,
            periodHours: 24,
          },
          {
            id: 'weekly',
            label: 'Weekly',
            remainingPercent: 80,
            resetAtMs: NOW + 4 * DAY_MS,
            periodHours: 168,
          },
        ],
      } as unknown as QuotaCardState,
      NOW
    );
    expect(devin).toMatchObject({
      remaining: 25,
      resetAtMs: NOW + 6 * HOUR_MS,
      tone: 'low',
    });

    const kimi = summarizeCredentialQuota(
      'kimi',
      {
        status: 'success',
        rows: [
          {
            id: 'daily',
            label: 'Daily',
            used: 200,
            limit: 1000,
            resetAtMs: NOW + 8 * HOUR_MS,
            periodHours: 24,
          },
        ],
      } as unknown as QuotaCardState,
      NOW
    );
    expect(kimi).toMatchObject({
      remaining: 80,
      resetAtMs: NOW + 8 * HOUR_MS,
      tone: 'high',
      low: false,
    });

    const meta = summarizeCredentialQuota(
      'meta',
      {
        status: 'success',
        data: {
          windows: [
            {
              id: 'window',
              usedPercent: 0,
              resetAt: Math.floor((NOW + 2 * HOUR_MS) / 1000),
              durationMinutes: 300,
            },
            { id: 'weekly', usedPercent: 65, resetAt: Math.floor((NOW + 3 * DAY_MS) / 1000) },
          ],
        },
      } as unknown as QuotaCardState,
      NOW
    );
    expect(meta.remaining).toBe(35);
    expect(meta.tone).toBe('medium');
    expect(meta.resetAtMs).toBe(Math.floor((NOW + 3 * DAY_MS) / 1000) * 1000);

    const xaiWeekly = summarizeCredentialQuota(
      'xai',
      {
        status: 'success',
        billing: { periodType: 'weekly', usagePercent: 80, resetAtMs: NOW + 2 * DAY_MS },
      } as unknown as QuotaCardState,
      NOW
    );
    expect(xaiWeekly).toMatchObject({
      status: 'success',
      remaining: 20,
      resetAtMs: NOW + 2 * DAY_MS,
      tone: 'low',
    });

    const xaiMonthly = summarizeCredentialQuota(
      'xai',
      {
        status: 'success',
        billing: { periodType: 'monthly', usagePercent: 50, resetAtMs: NOW + 10 * DAY_MS },
      } as unknown as QuotaCardState,
      NOW
    );
    expect(xaiMonthly).toMatchObject({
      status: 'success',
      remaining: null,
      resetAtMs: null,
      tone: null,
    });
  });

  test('returns null remaining for idle, loading, error and elapsed resets do not borrow other windows', () => {
    expect(summarizeCredentialQuota('codex', undefined, NOW)).toMatchObject({
      status: 'idle',
      remaining: null,
    });
    expect(summarizeCredentialQuota('codex', { status: 'loading' }, NOW)).toMatchObject({
      status: 'loading',
      remaining: null,
    });
    expect(
      summarizeCredentialQuota('codex', { status: 'error', error: 'boom' }, NOW)
    ).toMatchObject({
      status: 'error',
      remaining: null,
    });

    const elapsedTightest = summarizeCredentialQuota(
      'codex',
      {
        status: 'success',
        windows: [
          {
            id: 'five-hour',
            label: '5h',
            usedPercent: 90,
            resetAtMs: NOW - MINUTE_MS,
            periodHours: 5,
          },
          {
            id: 'weekly',
            label: '7d',
            usedPercent: 20,
            resetAtMs: NOW + 4 * DAY_MS,
            periodHours: 168,
          },
        ],
      } as unknown as QuotaCardState,
      NOW
    );
    expect(elapsedTightest.remaining).toBe(10);
    expect(elapsedTightest.resetAtMs).toBeNull();
  });
});

describe('authIndex to quota entry mapping and sorting', () => {
  test('indexes quota-capable files by normalized authIndex and skips disabled or runtime-only items', () => {
    const files: AuthFileItem[] = [
      makeFile({ name: 'runtime-key', authIndex: '10', runtimeOnly: true }),
      makeFile({ name: 'disabled.json', authIndex: '11', disabled: true }),
      makeFile({ name: 'vertex.json', authIndex: '12', type: 'vertex', provider: 'vertex' }),
      makeFile({
        name: 'codex-a.json',
        authIndex: 13 as unknown as string,
        email: 'a@example.com',
      }),
      makeFile({
        name: 'custom-plugin.json',
        authIndex: ' 14 ',
        type: 'custom-oauth',
        provider: 'custom-oauth',
        supportsQuota: true,
      }),
    ];

    expect(resolveUsageQuotaEntry(files[0])).toBeNull();
    expect(resolveUsageQuotaEntry(files[1])).toBeNull();
    expect(resolveUsageQuotaEntry(files[2])).toBeNull();

    const index = indexQuotaEntriesByAuthIndex(files);
    expect([...index.keys()]).toEqual(['13', '14']);
    expect(index.get('13')?.type).toBe('codex');
    expect(index.get('14')?.type).toBe('plugin');

    const targets = collectCredentialQuotaTargets(
      [{ authIndex: '10' }, { authIndex: '13' }, { authIndex: '13' }, { authIndex: '14' }],
      (authIndex) => index.get(authIndex) ?? null
    );
    expect(targets.map((t) => t.file.name)).toEqual(['codex-a.json', 'custom-plugin.json']);
  });

  test('names credentials by email unless another file shares that email', () => {
    const names = credentialNamesByAuthIndex([
      makeFile({ name: 'codex-a@example.com-plus.json', authIndex: '1', email: 'a@example.com' }),
      makeFile({
        name: 'claude-a@example.com.json',
        authIndex: '2',
        email: 'A@example.com',
        type: 'claude',
        provider: 'claude',
      }),
      makeFile({ name: 'codex-b@example.com.json', authIndex: '3', email: 'b@example.com' }),
      makeFile({ name: 'vertex.json', authIndex: '4', type: 'vertex', provider: 'vertex' }),
    ]);
    expect(Object.fromEntries(names)).toEqual({
      '1': 'codex-a@example.com-plus.json',
      '2': 'claude-a@example.com.json',
      '3': 'b@example.com',
      '4': 'vertex.json',
    });
  });

  test('sorts remaining quota with unloaded, error and unsupported credentials last in both directions', () => {
    const rows = [
      { id: 'unloaded', remaining: null },
      { id: 'mid', remaining: 62 },
      { id: 'no-adapter', remaining: null },
      { id: 'low', remaining: 9 },
      { id: 'high', remaining: 85 },
    ];
    expect(sortRows(rows, (r) => r.remaining, 'asc').map((r) => r.id)).toEqual([
      'low',
      'mid',
      'high',
      'unloaded',
      'no-adapter',
    ]);
    expect(sortRows(rows, (r) => r.remaining, 'desc').map((r) => r.id)).toEqual([
      'high',
      'mid',
      'low',
      'unloaded',
      'no-adapter',
    ]);
  });
});

describe('usage quota static rendering', () => {
  test('renders CredentialQuotaCell for unsupported, idle and loaded low-quota states', async () => {
    const prevLang = i18n.language;
    await i18n.changeLanguage('en');
    try {
      const dashMarkup = renderToStaticMarkup(
        createElement(CredentialQuotaCell, {
          entry: null,
          summary: null,
          credentialLabel: 'sk-compat',
          nowMs: NOW,
          onOpen: () => {},
        })
      );
      expect(dashMarkup).toContain('—');
      expect(dashMarkup).not.toContain('<button');

      const entry = {
        file: makeFile({ name: 'claude-b.json', authIndex: '2' }),
        type: 'claude' as const,
      };
      const lowSummary = summarizeCredentialQuota(
        'claude',
        {
          status: 'success',
          windows: [
            {
              id: 'five_hour',
              label: '5h',
              usedPercent: 91,
              resetAtMs: NOW + 41 * MINUTE_MS,
              periodHours: 5,
            },
          ],
        } as unknown as QuotaCardState,
        NOW
      );
      const cellMarkup = renderToStaticMarkup(
        createElement(CredentialQuotaCell, {
          entry,
          summary: lowSummary,
          credentialLabel: 'claude-b@example.com',
          nowMs: NOW,
          onOpen: () => {},
        })
      );
      expect(cellMarkup).toContain('width:9%');
      expect(cellMarkup).toContain('9%');
      expect(cellMarkup).toContain('resets in 41 minutes');
      expect(cellMarkup).toContain(
        'aria-label="View quota for claude-b@example.com — 9% · resets in 41 minutes"'
      );
    } finally {
      await i18n.changeLanguage(prevLang);
    }
  });

  test('renders OverviewTab credential quota column from shared useQuotaStore cache', async () => {
    const prevLang = i18n.language;
    await i18n.changeLanguage('en');
    const codexFile = makeFile({
      name: 'codex-a.json',
      authIndex: 'c1',
      email: 'codex-a@example.com',
    });
    const claudeFile = makeFile({
      name: 'claude-b.json',
      authIndex: 'c2',
      type: 'claude',
      provider: 'claude',
      email: 'claude-b@example.com',
    });
    const entryMap = indexQuotaEntriesByAuthIndex([codexFile, claudeFile]);

    useQuotaStore.getState().setCodexQuota({
      'codex-a.json': {
        status: 'success',
        windows: [
          {
            id: 'five-hour',
            label: '5h',
            usedPercent: 38,
            resetLabel: '14:00',
            resetAtMs: NOW + 2 * HOUR_MS,
            periodHours: 5,
          },
        ],
      },
    });

    try {
      expect(
        readCachedQuota(useQuotaStore.getState() as unknown as QuotaStore, entryMap.get('c1')!)
          ?.status
      ).toBe('success');

      const aggregate = {
        requests: 100,
        failed: 2,
        substituted: 0,
        cost: 3.5,
        unpriced_requests: 0,
        avg_latency_ms: 200,
        avg_ttft_ms: 50,
        output_tps: 60,
        tokens: { input_uncached: 500, cache_read: 500, output: 200, reasoning: 0, total: 1200 },
      };
      const stats = normalizeUsageStats({
        from: 0,
        to: 3600,
        bucket: 'hour',
        totals: aggregate,
        series: [{ time: 0, ...aggregate }],
        models: [],
        api_keys: [],
        credentials: [
          { auth_index: 'c1', provider: 'codex', source: 'codex-a', ...aggregate },
          { auth_index: 'c2', provider: 'claude', source: 'claude-b', ...aggregate },
          { auth_index: 'compat-1', provider: 'openai', source: 'sk-compat', ...aggregate },
        ],
      });

      const markup = renderToStaticMarkup(
        createElement(OverviewTab, {
          stats,
          prevStats: null,
          prices: [],
          labels: {
            credential: (authIndex: string, source?: string) =>
              entryMap.get(authIndex)?.file.email || source || authIndex,
            keyName: () => null,
            quotaEntry: (authIndex: string) => entryMap.get(authIndex) ?? null,
          },
          onOpenEvents: () => {},
          onDrillDown: () => {},
          connected: true,
          nowMs: NOW,
        })
      );

      expect(markup).toContain('Remaining quota');
      expect(markup).toContain('Load quota');
      expect(markup).toContain('width:62%');
      expect(markup).toContain('resets in 2 hours');
      expect(markup).toContain('aria-label="View quota for claude-b@example.com — View"');
      expect(markup).toContain('>—<');
    } finally {
      useQuotaStore.getState().clearQuotaCache();
      await i18n.changeLanguage(prevLang);
    }
  });
});
