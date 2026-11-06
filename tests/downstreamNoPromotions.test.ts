import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import { SPONSORS } from '@/features/config/sponsors';
import { OAuthPage } from '@/features/oauth/OAuthPage';
import { ProviderResourcePanel } from '@/features/providers/components/ProviderResourcePanel';
import { PROVIDER_BRAND_ORDER } from '@/features/providers/descriptors';
import {
  getKimiAffiliateUrl,
  KIMI_CHINESE_AFFILIATE_URL,
  KIMI_INTERNATIONAL_AFFILIATE_URL,
} from '@/features/providers/kimi';
import { buildProviderGroups } from '@/features/providers/useProviderWorkbench';
import type { Config } from '@/types';

const PROMOTIONAL_BRANDS = ['apikeyFun', 'fennoAI', 'qiniuCloud', 'aiCodeMirror'] as const;
const AFFILIATE_PATTERN = /[?&](aff|invitecode|invite_code|ref|referral)=/i;

const noop = () => {};

/**
 * Generic guard for promotions upstream adds later: any affiliate/referral/tracking query
 * parameter or `rel="sponsored"` in shipped source fails the build, wherever it appears.
 * A failure here means upstream added a new promotion; remove it in this patch rather than
 * extending the allowlist. The allowlist only names templates proven unreachable elsewhere.
 */
const SHIPPED_PROMO_PATTERN =
  /[?&](aff|affiliate|invite|invitecode|invite_code|inviter|ref|referral|referrer|keyword|coupon|promo|utm_[a-z]+)=|\bsponsored\b/i;
const SHIPPED_PROMO_ALLOWLIST: Record<string, RegExp> = {
  // Sponsor row template; SPONSORS is empty, asserted below, so it never renders.
  'src/features/config/components/fields/sharedFields.tsx': /rel="noopener noreferrer sponsored"/,
};

const listShippedFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listShippedFiles(path);
    return /\.(tsx?|json|s?css|html)$/.test(name) ? [path.replace(/\\/g, '/')] : [];
  });

const renderWithI18n = async (lng: 'en' | 'zh-CN', element: ReturnType<typeof createElement>) => {
  const i18n = createInstance();
  await i18n.init({
    lng,
    resources: { en: { translation: en }, 'zh-CN': { translation: zhCN } },
  });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
};

describe('downstream carries no promotions', () => {
  test('promotional provider brands get no group of their own', () => {
    for (const brand of PROMOTIONAL_BRANDS) {
      expect(PROVIDER_BRAND_ORDER).not.toContain(brand);
    }
    const ids = buildProviderGroups({}).map((group) => group.id);
    for (const brand of PROMOTIONAL_BRANDS) {
      expect(ids).not.toContain(brand);
    }
    expect(ids).toContain('kimi');
  });

  test('configs on promotional endpoints stay editable in the generic protocol groups', () => {
    const endpoints = [
      'https://api.apikey.fan',
      'https://api.fenno.ai',
      'https://api.qnaigc.com',
      'https://api.aicodemirror.ai',
    ];
    const keys = endpoints.map((baseUrl) => ({ apiKey: `test-${baseUrl}`, baseUrl }));
    const config: Config = {
      geminiApiKeys: keys,
      codexApiKeys: keys,
      claudeApiKeys: keys,
      openaiCompatibility: [
        { name: 'apikeyFun', baseUrl: 'https://api.apikey.fan/v1', apiKeyEntries: [] },
        { name: 'aiCodeMirror', baseUrl: 'https://api.aicodemirror.ai/v1', apiKeyEntries: [] },
      ],
    };
    const groups = buildProviderGroups(config);
    const count = (brand: string) =>
      groups.find((group) => group.id === brand)?.resources.length ?? 0;
    expect(count('gemini')).toBe(endpoints.length);
    expect(count('codex')).toBe(endpoints.length);
    expect(count('claude')).toBe(endpoints.length);
    expect(count('openaiCompatibility')).toBe(2);
  });

  test('shipped source carries no affiliate, referral or sponsored link', () => {
    const hits: string[] = [];
    for (const file of [...listShippedFiles('src'), 'index.html']) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (!SHIPPED_PROMO_PATTERN.test(line)) return;
          if (SHIPPED_PROMO_ALLOWLIST[file]?.test(line)) return;
          hits.push(`${file}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test('the proxy URL field has no sponsor link', () => {
    expect(SPONSORS).toHaveLength(0);
  });

  test('Kimi sign-up links carry no affiliate code', () => {
    for (const url of [
      KIMI_CHINESE_AFFILIATE_URL,
      KIMI_INTERNATIONAL_AFFILIATE_URL,
      getKimiAffiliateUrl('zh-CN'),
      getKimiAffiliateUrl('en'),
    ]) {
      expect(new URL(url).search).toBe('');
    }
  });

  test('the OAuth page renders no affiliate link', async () => {
    for (const lng of ['en', 'zh-CN'] as const) {
      const markup = await renderWithI18n(
        lng,
        createElement(MemoryRouter, null, createElement(OAuthPage))
      );
      expect(markup).not.toMatch(AFFILIATE_PATTERN);
    }
  });

  test('the Kimi provider panel keeps a plain sign-up link and drops the recharge promo', async () => {
    const markup = await renderWithI18n(
      'zh-CN',
      createElement(ProviderResourcePanel, {
        group: { id: 'kimi', resources: [] },
        filter: '',
        onFilterChange: noop,
        filteredResources: [],
        selectedId: null,
        onView: noop,
        onEdit: noop,
        onDelete: noop,
        onCreate: noop,
      })
    );
    expect(markup).toContain(`href="${KIMI_CHINESE_AFFILIATE_URL}"`);
    expect(markup).not.toMatch(AFFILIATE_PATTERN);
    expect(markup).not.toContain(zhCN.providersPage.sponsor.kimiPromo);
  });

  test('the providers page no longer mounts the sponsor campaign or quick-start panels', () => {
    const source = readFileSync('src/features/providers/ProvidersWorkbenchPage.tsx', 'utf8');
    expect(source).not.toContain('SponsorCampaignCard');
    expect(source).not.toContain('SponsorQuickStartPanel');
  });
});
