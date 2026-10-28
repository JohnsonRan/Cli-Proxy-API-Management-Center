/**
 * 本地存储混淆工具函数（可逆）
 * 从原项目 src/utils/secure-storage.js 迁移
 *
 * IMPORTANT: 这不是安全边界。浏览器端长期持久化的密钥仍应视为可被读取。
 */

const ENC_PREFIX = 'enc::v1::';
const SECRET_SALT = 'cli-proxy-api-webui::secure-storage';

const UA_MIGRATION_MARKER = 'cpa_obfuscation_ua_migrated';
const UA_MIGRATION_VERSION = 'v1';
// Browser version numbers change on every update; keying on them made saved
// values unreadable after an upgrade. Keep this pattern identical to the shim the
// downstream core injected earlier so data it migrated stays readable.
const BROWSER_VERSION_PATTERN =
  /\b(Chrome|CriOS|Chromium|Edg|EdgA|EdgiOS|Firefox|FxiOS|Version|OPR|Brave|Vivaldi)\/\d+(?:\.\d+)*/g;
const ENC_TOKEN_PATTERN = /enc::v1::[A-Za-z0-9+/=]+/g;

let cachedKeyBytes: Uint8Array | null = null;

/**
 * Replace browser version numbers with 0 so the obfuscation key survives upgrades.
 */
export function canonicalUserAgent(userAgent: string): string {
  return userAgent.replace(BROWSER_VERSION_PATTERN, '$1/0');
}

function keyBytesFor(host: string, userAgent: string): Uint8Array {
  return encodeText(`${SECRET_SALT}|${host}|${userAgent}`);
}

function encodeText(text: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(text);
}

function decodeText(bytes: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

function getKeyBytes(): Uint8Array {
  if (cachedKeyBytes) return cachedKeyBytes;

  try {
    cachedKeyBytes = keyBytesFor(window.location.host, canonicalUserAgent(navigator.userAgent));
  } catch (error) {
    console.warn('Obfuscation fallback to simple key:', error);
    cachedKeyBytes = encodeText(SECRET_SALT);
  }

  return cachedKeyBytes;
}

function xorBytes(data: Uint8Array, keyBytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  return result;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 加密数据
 */
export function obfuscateData(value: string): string {
  if (!value) return value;

  try {
    const keyBytes = getKeyBytes();
    const encrypted = xorBytes(encodeText(value), keyBytes);
    return `${ENC_PREFIX}${toBase64(encrypted)}`;
  } catch (error) {
    console.warn('Obfuscation failed, fallback to plaintext:', error);
    return value;
  }
}

/**
 * 解密数据
 */
export function deobfuscateData(payload: string): string {
  if (!payload || !payload.startsWith(ENC_PREFIX)) {
    return payload;
  }

  try {
    const encodedBody = payload.slice(ENC_PREFIX.length);
    const encrypted = fromBase64(encodedBody);
    const decrypted = xorBytes(encrypted, getKeyBytes());
    return decodeText(decrypted);
  } catch (error) {
    console.warn('Deobfuscation failed, return as-is:', error);
    return payload;
  }
}

/**
 * 检查是否已加密
 */
export function isObfuscated(value: string): boolean {
  return value?.startsWith(ENC_PREFIX) || false;
}

interface MigratableStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Re-key values obfuscated with the full, versioned User-Agent onto the
 * canonical one. Runs once per browser profile; the marker is shared with the
 * shim the downstream core injected earlier, so values it already migrated are
 * left alone.
 */
export function migrateUserAgentObfuscationKey(
  storage: MigratableStorage,
  host: string,
  userAgent: string
): void {
  const canonical = canonicalUserAgent(userAgent);
  if (!userAgent || userAgent === canonical) return;
  if (storage.getItem(UA_MIGRATION_MARKER) === UA_MIGRATION_VERSION) return;

  const oldKey = keyBytesFor(host, userAgent);
  const newKey = keyBytesFor(host, canonical);
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    const value = storage.getItem(key);
    if (!value || !value.includes(ENC_PREFIX)) continue;
    const updated = value.replace(ENC_TOKEN_PATTERN, (token) => {
      try {
        const plain = xorBytes(fromBase64(token.slice(ENC_PREFIX.length)), oldKey);
        return `${ENC_PREFIX}${toBase64(xorBytes(plain, newKey))}`;
      } catch {
        return token;
      }
    });
    if (updated !== value) storage.setItem(key, updated);
  }
  storage.setItem(UA_MIGRATION_MARKER, UA_MIGRATION_VERSION);
}

/**
 * Run the User-Agent key migration against this browser's localStorage.
 * Call before anything reads obfuscated values.
 */
export function migrateStoredObfuscationKey(): void {
  try {
    migrateUserAgentObfuscationKey(localStorage, window.location.host, navigator.userAgent);
  } catch (error) {
    console.warn('Obfuscation key migration failed:', error);
  }
}
