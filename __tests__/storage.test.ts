/**
 * Storage reporting, and the path conversion it depends on.
 *
 * `toFileUri` exists because expo-file-system addresses files by `file://`
 * URI while `SQLite.defaultDatabaseDirectory` hands back a bare path. Passing
 * the bare path through does not raise — getInfoAsync simply reports the file
 * as absent. That surfaced as a Settings screen claiming the offline Bible
 * occupied 0 bytes, and as the patristic download reporting itself as never
 * downloaded no matter how many times it had been fetched.
 */

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readDirectoryAsync: jest.fn(async () => []),
  deleteAsync: jest.fn(async () => {}),
}));

jest.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: '/data/user/0/online.birhan.app/files/SQLite',
}));

import { toFileUri, formatBytes } from '../src/lib/storage';

describe('toFileUri', () => {
  test('adds the scheme to the bare path expo-sqlite returns', () => {
    expect(toFileUri('/data/user/0/online.birhan.app/files/SQLite')).toBe(
      'file:///data/user/0/online.birhan.app/files/SQLite',
    );
  });

  test('leaves an existing file:// URI alone rather than doubling it', () => {
    expect(toFileUri('file:///doc/x.db')).toBe('file:///doc/x.db');
  });

  test('leaves other schemes alone', () => {
    expect(toFileUri('content://media/1')).toBe('content://media/1');
    expect(toFileUri('https://birhan.online/x.db')).toBe('https://birhan.online/x.db');
  });

  test('an empty path stays empty rather than becoming "file://"', () => {
    expect(toFileUri('')).toBe('');
  });
});

describe('formatBytes', () => {
  test('scales to the unit a person would say out loud', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(80_429_056)).toBe('77 MB');
    expect(formatBytes(155_967_163)).toBe('149 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});
