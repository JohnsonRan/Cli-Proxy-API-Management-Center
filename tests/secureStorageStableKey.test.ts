import { afterEach, describe, expect, test } from 'bun:test';
import {
  canonicalUserAgent,
  deobfuscateData,
  migrateUserAgentObfuscationKey,
} from '../src/utils/encryption';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
  for (const [key, descriptor] of [
    ['window', originalWindow],
    ['navigator', originalNavigator],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const HOST = 'panel.test:8317';
const SALT = 'cli-proxy-api-webui::secure-storage';
const PREFIX = 'enc::v1::';
const CHROME_154 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.7712.4 Safari/537.36 Edg/154.0.3500.12';
const CHROME_155 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.7801.2 Safari/537.36 Edg/155.0.3511.4';

// Independent copy of the obfuscation scheme, so the test fails if the
// implementation drifts from what browsers already stored.
function obfuscate(value: string, userAgent: string): string {
  const key = new TextEncoder().encode(`${SALT}|${HOST}|${userAgent}`);
  const data = new TextEncoder().encode(value);
  let binary = '';
  data.forEach((byte, i) => {
    binary += String.fromCharCode(byte ^ key[i % key.length]);
  });
  return PREFIX + btoa(binary);
}

function memoryStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('stable secure-storage key', () => {
  test('ignores browser version numbers', () => {
    expect(canonicalUserAgent(CHROME_154)).toBe(canonicalUserAgent(CHROME_155));
    expect(canonicalUserAgent(CHROME_154)).toContain('Chrome/0 ');
    expect(canonicalUserAgent(canonicalUserAgent(CHROME_154))).toBe(canonicalUserAgent(CHROME_154));
  });

  test('re-keys values stored under the versioned User-Agent', () => {
    const storage = memoryStorage({
      managementKey: obfuscate('"secret-key"', CHROME_154),
      'cli-proxy-auth': JSON.stringify({
        state: { apiBase: obfuscate('"https://cpa.test"', CHROME_154) },
      }),
      theme: 'dark',
    });
    migrateUserAgentObfuscationKey(storage, HOST, CHROME_154);

    const canonical = canonicalUserAgent(CHROME_155);
    expect(storage.values.get('managementKey')).toBe(obfuscate('"secret-key"', canonical));
    expect(storage.values.get('cli-proxy-auth')).toContain(
      obfuscate('"https://cpa.test"', canonical)
    );
    expect(storage.values.get('theme')).toBe('dark');
    expect(storage.values.get('cpa_obfuscation_ua_migrated')).toBe('v1');
  });

  test('leaves values the core shim already migrated untouched', () => {
    const migrated = obfuscate('"secret-key"', canonicalUserAgent(CHROME_154));
    const storage = memoryStorage({ managementKey: migrated, cpa_obfuscation_ua_migrated: 'v1' });
    migrateUserAgentObfuscationKey(storage, HOST, CHROME_155);
    expect(storage.values.get('managementKey')).toBe(migrated);
  });

  test('does nothing when the User-Agent is already canonical', () => {
    // The core shim overrode navigator.userAgent with the canonical value.
    const stored = obfuscate('"secret-key"', canonicalUserAgent(CHROME_154));
    const storage = memoryStorage({ managementKey: stored });
    migrateUserAgentObfuscationKey(storage, HOST, canonicalUserAgent(CHROME_154));
    expect(storage.values.get('managementKey')).toBe(stored);
    expect(storage.values.has('cpa_obfuscation_ua_migrated')).toBe(false);
  });

  test('reads migrated legacy values after a browser update', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { host: HOST } },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: CHROME_155 },
    });
    const stored = obfuscate('"key-name"', canonicalUserAgent(CHROME_154));
    expect(deobfuscateData(stored)).toBe('"key-name"');
  });
});
