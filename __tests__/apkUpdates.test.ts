import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import {
  isValidHttpsUrl,
  getCurrentVersionCode,
  shouldCheckApkUpdate,
  LAST_APK_CHECK_KEY,
  ApkManifest,
} from '../src/lib/apkUpdates';

describe('APK Updates Unit Tests', () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem(LAST_APK_CHECK_KEY);
  });

  describe('isValidHttpsUrl Security Enforcement', () => {
    test('accepts valid HTTPS domain URLs', () => {
      expect(isValidHttpsUrl('https://updates.birhan.online/birhan/latest.json')).toBe(true);
      expect(isValidHttpsUrl('https://example.com/apk/birhan-v0.5.0.apk')).toBe(true);
    });

    test('refuses plain HTTP URLs', () => {
      expect(isValidHttpsUrl('http://updates.birhan.online/birhan/latest.json')).toBe(false);
      expect(isValidHttpsUrl('http://example.com/latest.json')).toBe(false);
    });

    test('refuses raw IPv4 and IPv6 URLs even over HTTPS', () => {
      expect(isValidHttpsUrl('http://191.215.40.44/latest.json')).toBe(false);
      expect(isValidHttpsUrl('https://191.215.40.44/latest.json')).toBe(false);
      expect(isValidHttpsUrl('https://191.215.40.44:8443/latest.json')).toBe(false);
      expect(isValidHttpsUrl('https://[2001:db8::1]/latest.json')).toBe(false);
    });

    test('handles malformed inputs safely without throwing', () => {
      expect(isValidHttpsUrl('')).toBe(false);
      expect(isValidHttpsUrl('not-a-url')).toBe(false);
      expect(isValidHttpsUrl(null as any)).toBe(false);
    });
  });

  describe('getCurrentVersionCode', () => {
    test('returns a valid numeric version code >= 1', () => {
      const code = getCurrentVersionCode();
      expect(typeof code).toBe('number');
      expect(code).toBeGreaterThanOrEqual(1);
    });
  });

  describe('shouldCheckApkUpdate (24-Hour Rate Limiting)', () => {
    test('returns true when no previous check has been recorded', async () => {
      const result = await shouldCheckApkUpdate();
      expect(result).toBe(true);
    });

    test('returns false if check occurred within the last 24 hours', async () => {
      const recentTimestamp = Date.now() - 60 * 60 * 1000; // 1 hour ago
      await AsyncStorage.setItem(LAST_APK_CHECK_KEY, recentTimestamp.toString());
      const result = await shouldCheckApkUpdate();
      expect(result).toBe(false);
    });

    test('returns true if previous check was more than 24 hours ago', async () => {
      const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      await AsyncStorage.setItem(LAST_APK_CHECK_KEY, oldTimestamp.toString());
      const result = await shouldCheckApkUpdate();
      expect(result).toBe(true);
    });
  });
});
