/**
 * The update has to verify against the bytes that were downloaded.
 *
 * This exists because it did not. `computeFileSha256` read the APK as base64
 * and hashed *that text*, while the manifest carries the SHA-256 of the file's
 * bytes. Those two values cannot be equal, so every download that ever
 * completed was judged corrupt, deleted, and reported as a hash mismatch — the
 * update flow could not have succeeded for anyone.
 *
 * The old suite never called it. It tested URL validation and the throttle, so
 * the one function standing between a download and an install was unexercised.
 *
 * These tests use real SHA-256 vectors and a file large enough to cross the
 * chunk boundary, because a hash that is only correct for inputs smaller than
 * one read is not correct.
 */

/**
 * Expected digests are fixed vectors, computed independently, rather than
 * recomputed here from the same primitive under test. The app's tsconfig
 * deliberately exposes only jest's globals (`types: ["jest"]`), so Node's
 * Buffer and crypto are not in scope — and widening that to make a test
 * convenient would let Node-only APIs pass typecheck in app code, where they
 * do not exist at runtime.
 */

const mockFiles = new Map<string, Uint8Array>();

/** Bytes → base64, standing in for what the native file API returns. */
function mockBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** ASCII string → bytes. */
function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

const toText = (bytes: Uint8Array) =>
  Array.from(bytes).map((b) => String.fromCharCode(b)).join('');

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: jest.fn(async (uri: string) => {
    const f = mockFiles.get(uri);
    return f ? { exists: true, uri, size: f.length } : { exists: false, uri };
  }),
  // Mirrors the real contract: `position`/`length` slice the file, and each
  // slice is base64-encoded independently.
  readAsStringAsync: jest.fn(async (uri: string, opts: any) => {
    const f = mockFiles.get(uri);
    if (!f) throw new Error('missing file');
    const start = opts?.position ?? 0;
    const len = opts?.length ?? f.length - start;
    return mockBytesToBase64(f.subarray(start, start + len));
  }),
  deleteAsync: jest.fn(async (uri: string) => void mockFiles.delete(uri)),
  createDownloadResumable: jest.fn((url: string, dest: string) => ({
    downloadAsync: async () => {
      // Whatever the fake server is set to serve this time.
      const body = (globalThis as any).__mockDownloadBody as Uint8Array | undefined;
      if (!body) throw new Error('network failed');
      mockFiles.set(dest, body);
      return { uri: dest };
    },
    cancelAsync: async () => {},
  })),
  getContentUriAsync: jest.fn(async (u: string) => u),
}));

jest.mock('expo-application', () => ({
  nativeBuildVersion: '7',
  nativeApplicationVersion: '1.0.6',
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.6', android: { versionCode: 7 } } },
}));

jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));
jest.mock('../src/lib/errors', () => ({ reportError: jest.fn() }));

import { base64ToBytes } from '../src/lib/base64';
import {
  downloadAndVerifyApk,
  computeFileSha256,
  checkForApkUpdate,
  getCurrentVersionCode,
  LAST_APK_CHECK_KEY,
} from '../src/lib/apkUpdates';

const AsyncStorage = require('@react-native-async-storage/async-storage');

beforeEach(() => {
  mockFiles.clear();
  AsyncStorage.__store.clear();
  jest.clearAllMocks();
});

describe('base64ToBytes', () => {
  test('decodes the standard RFC 4648 vectors', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [plain, encoded] of cases) {
      expect(toText(base64ToBytes(encoded))).toBe(plain);
    }
  });

  test('round-trips arbitrary bytes including 0x00 and 0xff', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255, 0, 42]);
    expect(base64ToBytes(mockBytesToBase64(bytes))).toEqual(bytes);
  });

  test('rejects rather than silently skipping invalid characters', () => {
    expect(() => base64ToBytes('Zm9v!!')).toThrow();
  });
});

describe('computeFileSha256', () => {
  test('hashes the file bytes, not the base64 text they arrive in', async () => {
    mockFiles.set('file:///doc/a.apk', ascii('pretend this is an apk'));

    // sha256 of the 22 bytes.
    const ofBytes = '09d95ade94de5bbe7d1e4f02d1c3d7f30b2a156e61d532b418833fedad3fcb92';
    // sha256 of "cHJldGVuZCB0aGlzIGlzIGFuIGFwaw==" — what the old code returned.
    const ofBase64Text = '001aae31a0b2e5710c042f15fd792381c354fc555fb44def28575a93b1ef0cd8';

    const actual = await computeFileSha256('file:///doc/a.apk');

    expect(actual).toBe(ofBytes);
    expect(actual).not.toBe(ofBase64Text);
  });

  test('is correct across chunk boundaries for a multi-megabyte file', async () => {
    // Larger than the 3 MB read size, and deliberately not a multiple of it.
    const big = new Uint8Array(7 * 1024 * 1024 + 12345);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
    mockFiles.set('file:///doc/big.apk', big);

    await expect(computeFileSha256('file:///doc/big.apk')).resolves.toBe(
      'fbf5ba138e4c92eb440ec30e76e6f599b542abf34eae1f587ea66fae56ca065d',
    );
  });

  test('hashes an empty file to the known empty digest', async () => {
    mockFiles.set('file:///doc/empty.apk', new Uint8Array(0));
    await expect(computeFileSha256('file:///doc/empty.apk')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('refuses to hash a file that is not there', async () => {
    await expect(computeFileSha256('file:///doc/gone.apk')).rejects.toThrow();
  });
});

describe('getCurrentVersionCode', () => {
  test('trusts the installed binary over app.json', () => {
    // app.json in the mock claims 7 as well; the point is that the package
    // value is read first, so a stale app.json cannot inflate it.
    expect(getCurrentVersionCode()).toBe(7);
  });
});

const manifest = (over: Record<string, unknown> = {}) => ({
  versionCode: 9,
  versionName: '1.0.8',
  apkUrl: 'https://updates.birhan.online/birhan/birhan-1.0.8.apk',
  sha256: 'a'.repeat(64),
  sizeBytes: 1024,
  releasedAt: '2026-09-01T00:00:00Z',
  minSupportedVersionCode: 1,
  notes_am: 'x',
  notes_en: 'x',
  mandatory: false,
  ...over,
});

describe('checkForApkUpdate never reports a failure as good news', () => {
  test('a network error is a failure, not "up to date"', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as any;

    const res = await checkForApkUpdate({ force: true });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') expect(res.reason).toBe('offline');
  });

  test('an HTTP error is a failure, not "up to date"', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 404 })) as any;

    const res = await checkForApkUpdate({ force: true });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') expect(res.reason).toBe('server');
  });

  test('a failed check does not record a timestamp, so the next try is not throttled', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as any;

    await checkForApkUpdate({ force: true });
    expect(AsyncStorage.__store.get(LAST_APK_CHECK_KEY)).toBeUndefined();
  });

  test('a newer versionCode is offered', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => manifest() })) as any;

    const res = await checkForApkUpdate({ force: true });
    expect(res.status).toBe('update-available');
  });

  test('the same versionCode is up to date', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => manifest({ versionCode: 7 }),
    })) as any;

    const res = await checkForApkUpdate({ force: true });
    expect(res.status).toBe('up-to-date');
  });

  test('compares versionCode numerically — 1.0.10 beats 1.0.9', async () => {
    // As strings "1.0.10" < "1.0.9", so a name-based compare would miss this.
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => manifest({ versionCode: 10, versionName: '1.0.10' }),
    })) as any;

    const res = await checkForApkUpdate({ force: true });
    expect(res.status).toBe('update-available');
  });

  test('a non-HTTPS apkUrl in the manifest is rejected', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => manifest({ apkUrl: 'http://evil.example/x.apk' }),
    })) as any;

    const res = await checkForApkUpdate({ force: true });
    expect(res.status).toBe('failed');
  });
});

describe('the throttle, and the way past it', () => {
  test('an unforced check inside 24 hours does not reach the network', async () => {
    AsyncStorage.__store.set(LAST_APK_CHECK_KEY, String(Date.now() - 60_000));
    globalThis.fetch = jest.fn() as any;

    const res = await checkForApkUpdate();
    expect(res.status).toBe('throttled');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('force ignores the throttle — this is what the Settings button uses', async () => {
    AsyncStorage.__store.set(LAST_APK_CHECK_KEY, String(Date.now() - 60_000));
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => manifest() })) as any;

    const res = await checkForApkUpdate({ force: true });
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(res.status).toBe('update-available');
  });
});


describe('a downloaded file that does not match the manifest', () => {
  // sha256 of the 22 ASCII bytes "pretend this is an apk".
  const GOOD_SHA = '09d95ade94de5bbe7d1e4f02d1c3d7f30b2a156e61d532b418833fedad3fcb92';

  const apkManifest = (sha: string) => ({
    ...manifest(),
    sha256: sha,
    apkUrl: 'https://updates.birhan.online/birhan/x.apk',
  });

  test('is deleted, and the failure says so rather than passing silently', async () => {
    (globalThis as any).__mockDownloadBody = ascii('a tampered apk');

    await expect(downloadAndVerifyApk(apkManifest(GOOD_SHA) as any)).rejects.toThrow(/SHA-256/);

    // Nothing is left behind for an installer to pick up.
    expect(mockFiles.has('file:///doc/birhan_update_v9.apk')).toBe(false);
  });

  test('a matching file is kept and returned', async () => {
    (globalThis as any).__mockDownloadBody = ascii('pretend this is an apk');

    const res = await downloadAndVerifyApk(apkManifest(GOOD_SHA) as any);

    expect(res.fileUri).toBe('file:///doc/birhan_update_v9.apk');
    expect(mockFiles.has('file:///doc/birhan_update_v9.apk')).toBe(true);
  });

  test('an already-present file with the wrong hash is replaced, not trusted', async () => {
    mockFiles.set('file:///doc/birhan_update_v9.apk', ascii('stale rubbish'));
    (globalThis as any).__mockDownloadBody = ascii('pretend this is an apk');

    const res = await downloadAndVerifyApk(apkManifest(GOOD_SHA) as any);
    expect(res.fileUri).toBe('file:///doc/birhan_update_v9.apk');
  });
});
