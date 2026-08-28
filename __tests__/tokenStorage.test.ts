/**
 * The session token has to actually reach the keychain.
 *
 * This exists because it once did not. The key was `birhan:auth_token`, and
 * expo-secure-store validates keys against /^[\w.-]+$/ — a colon is not in that
 * set, so every setItemAsync threw `Invalid key provided to SecureStore`. Sign-in
 * failed outright, and worse, a signup created the account on the server and
 * then could not store the session, leaving people on "your account was created"
 * with no way into the app.
 *
 * Nothing in the type system or the app's other tests could see it: the mock in
 * every other suite accepts any key. So this suite deliberately mocks
 * expo-secure-store with the SAME validation the real module applies, which is
 * the only way a test can tell a valid key from an invalid one.
 */

// The real rule, copied from expo-secure-store's isValidKey().
const mockKeyRule = /^[\w.-]+$/;

const mockStore = new Map<string, string>();
const mockSeenKeys: string[] = [];

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => {
    mockSeenKeys.push(key);
    if (!mockKeyRule.test(key)) {
      throw new Error(
        'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
      );
    }
    return mockStore.has(key) ? mockStore.get(key)! : null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSeenKeys.push(key);
    if (!mockKeyRule.test(key)) {
      throw new Error(
        'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
      );
    }
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSeenKeys.push(key);
    if (!mockKeyRule.test(key)) {
      throw new Error(
        'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
      );
    }
    mockStore.delete(key);
  }),
}));

import { getToken, setToken, clearToken } from '../src/lib/api';

beforeEach(() => {
  mockStore.clear();
  mockSeenKeys.length = 0;
});

describe('the key the app actually uses', () => {
  test('is one SecureStore will accept', async () => {
    await setToken('a-token');
    expect(mockSeenKeys.length).toBeGreaterThan(0);
    for (const k of mockSeenKeys) {
      expect(k).toMatch(mockKeyRule);
      // The specific character that broke it.
      expect(k).not.toContain(':');
    }
  });
});

describe('storing and reading the session token', () => {
  test('a token that is written can be read back', async () => {
    const ok = await setToken('header.payload.signature');
    expect(ok).toBe(true);
    await expect(getToken()).resolves.toBe('header.payload.signature');
  });

  test('clearing removes it', async () => {
    await setToken('a-token');
    await clearToken();
    await expect(getToken()).resolves.toBeNull();
  });

  test('reading with nothing stored returns null rather than throwing', async () => {
    await expect(getToken()).resolves.toBeNull();
  });
});

describe('a keychain failure never strands a signed-in user', () => {
  test('setToken reports failure instead of throwing', async () => {
    const SecureStore = require('expo-secure-store');
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));

    // The caller must be able to continue and set the session in memory; an
    // account created on the server must not be lost to a storage problem.
    await expect(setToken('a-token')).resolves.toBe(false);
  });

  test('getToken degrades to signed-out instead of throwing', async () => {
    const SecureStore = require('expo-secure-store');
    SecureStore.getItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));
    await expect(getToken()).resolves.toBeNull();
  });

  test('clearToken never throws', async () => {
    const SecureStore = require('expo-secure-store');
    SecureStore.deleteItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));
    await expect(clearToken()).resolves.toBeUndefined();
  });
});
