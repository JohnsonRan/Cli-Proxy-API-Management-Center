import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import {
  buildCommandCodeQuota,
  COMMANDCODE_CONFIG,
  resolveCommandCodePlan,
} from '@/features/quota/providers/commandcode/data';
import { resolveQuotaProviderType } from '@/features/quota/logic';
import { CALLBACK_SUPPORTED, OAUTH_PROVIDERS } from '@/features/oauth/providers';
import { BUILT_IN_QUOTA_PROVIDERS } from '@/utils/quota';
import type { AuthFileItem } from '@/types';

// Shapes as returned by api.commandcode.ai (see the official CLI's /usage command).
const CREDITS = {
  credits: { monthlyCredits: 52.5, purchasedCredits: 3, freeCredits: 0.5 },
  windowLimits: {
    limited: false,
    exceeded: null,
    fiveHour: { used: 2, cap: 8, exceeded: false, resetAt: 1792200000000 },
    weekly: { used: 30, cap: 40, exceeded: false, resetAt: 1792600000000 },
  },
};
const SUBSCRIPTION = {
  success: true,
  data: { planId: 'individual-goat', status: 'active', currentPeriodEnd: '2026-11-01T00:00:00Z' },
};

describe('Command Code quota', () => {
  test('builds windows, the monthly plan row and the credit summary', () => {
    const data = buildCommandCodeQuota(CREDITS, SUBSCRIPTION);
    expect(data?.plan).toBe('GOAT');
    expect(data?.creditsLeft).toBe(56);
    expect(data?.rows).toEqual([
      {
        id: 'five_hour',
        labelKey: 'commandcode_quota.five_hour',
        used: 2,
        limit: 8,
        resetAtMs: 1792200000000,
        periodHours: 5,
      },
      {
        id: 'weekly',
        labelKey: 'commandcode_quota.weekly',
        used: 30,
        limit: 40,
        resetAtMs: 1792600000000,
        periodHours: 168,
      },
      {
        id: 'monthly',
        labelKey: 'commandcode_quota.monthly',
        used: 17.5,
        limit: 70,
        resetAtMs: Date.parse('2026-11-01T00:00:00Z'),
        periodHours: null,
      },
    ]);
  });

  test('accepts string bodies and tolerates a missing subscription', () => {
    const data = buildCommandCodeQuota(JSON.stringify(CREDITS), null);
    expect(data?.plan).toBeNull();
    expect(data?.rows.map((row) => row.id)).toEqual(['five_hour', 'weekly']);
  });

  test('skips the monthly row without an active known plan', () => {
    const inactive = { data: { ...SUBSCRIPTION.data, status: 'canceled' } };
    expect(buildCommandCodeQuota(CREDITS, inactive)?.rows.map((row) => row.id)).toEqual([
      'five_hour',
      'weekly',
    ]);
    const unknown = { data: { ...SUBSCRIPTION.data, planId: 'enterprise-x' } };
    expect(buildCommandCodeQuota(CREDITS, unknown)?.plan).toBeNull();
  });

  test('returns null when the body carries no quota at all', () => {
    expect(buildCommandCodeQuota({}, SUBSCRIPTION)).toBeNull();
    expect(buildCommandCodeQuota('not json', null)).toBeNull();
  });

  test('resolves plans by the longest prefix', () => {
    expect(resolveCommandCodePlan('individual-goat-2026')?.name).toBe('GOAT');
    expect(resolveCommandCodePlan('individual_go')?.name).toBe('Go');
    expect(resolveCommandCodePlan('individual-pro-v1')?.monthlyCredits).toBe(80);
    expect(resolveCommandCodePlan('')).toBeNull();
  });

  test('classifies commandcode credentials into the built-in quota card', () => {
    const file = { name: 'commandcode-alice.json', provider: 'commandcode' } as AuthFileItem;
    expect(COMMANDCODE_CONFIG.filterFn(file)).toBe(true);
    expect(COMMANDCODE_CONFIG.filterFn({ ...file, disabled: true } as AuthFileItem)).toBe(false);
    expect(resolveQuotaProviderType(file)).toBe('commandcode');
    expect(BUILT_IN_QUOTA_PROVIDERS.has('commandcode')).toBe(true);
  });
});

describe('Command Code login', () => {
  test('is a browser login that accepts a pasted callback URL', () => {
    const card = OAUTH_PROVIDERS.find((provider) => provider.id === 'commandcode');
    expect(card?.flow).toBe('browser');
    expect(CALLBACK_SUPPORTED.has('commandcode')).toBe(true);
  });

  test('every locale carries the login and quota texts', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ko', 'ru', 'vi']) {
      const json = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      );
      for (const key of ['oauth_title', 'oauth_button', 'oauth_hint', 'oauth_status_success']) {
        expect(json.auth_login[`commandcode_${key}`]).toBeTruthy();
      }
      for (const key of ['title', 'idle', 'loading', 'load_failed', 'five_hour', 'weekly']) {
        expect(json.commandcode_quota[key]).toBeTruthy();
      }
    }
  });
});
