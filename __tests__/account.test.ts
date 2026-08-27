/**
 * The client half of account deletion.
 *
 * Two things are worth pinning. The sentinel the backend writes for a deleted
 * author has to be the one this app looks for — they are agreed by convention
 * across two repositories' worth of code and nothing type-checks the pair. And
 * a Telegram removal failure must never read as "your account was not deleted",
 * because it was.
 */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'a-token'),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

import { deleteAccount, displayAuthorName, DELETED_AUTHOR } from '../src/lib/account';

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];

function mockFetch(status: number, body: unknown) {
  calls = [];
  (globalThis as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

describe('the deleted-author sentinel', () => {
  test('matches the value the backend writes', () => {
    // backend/src/services/account-deletion.ts: DELETED_AUTHOR_SENTINEL
    expect(DELETED_AUTHOR).toBe('__deleted__');
  });

  test('renders a translated label, never the raw sentinel', () => {
    expect(displayAuthorName(DELETED_AUTHOR, 'en')).toBe('Deleted user');
    expect(displayAuthorName(DELETED_AUTHOR, 'am')).not.toContain('__');
    expect(displayAuthorName(DELETED_AUTHOR, 'am')).not.toBe(DELETED_AUTHOR);
  });

  test('leaves a real name alone', () => {
    expect(displayAuthorName('Abebe', 'en')).toBe('Abebe');
    expect(displayAuthorName('Abebe', 'am')).toBe('Abebe');
  });

  test('treats a missing name as deleted rather than rendering nothing', () => {
    expect(displayAuthorName(null, 'en')).toBe('Deleted user');
    expect(displayAuthorName('', 'en')).toBe('Deleted user');
  });
});

describe('deleting the account', () => {
  test('sends the password to DELETE /api/v1/me', async () => {
    mockFetch(200, { deleted: true, telegram: [] });

    const res = await deleteAccount('my-password');

    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe('https://api.birhan.test/api/v1/me');
    expect(calls[0].init.method).toBe('DELETE');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ password: 'my-password' });
  });

  test('carries the session — deletion is authenticated as well as re-confirmed', async () => {
    mockFetch(200, { deleted: true, telegram: [] });
    await deleteAccount('my-password');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer a-token');
  });

  test('reports a wrong password distinctly, so the screen can say so', async () => {
    mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    const res = await deleteAccount('wrong');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('WRONG_PASSWORD');
  });

  test('a Telegram failure is still a successful deletion', async () => {
    mockFetch(200, {
      deleted: true,
      telegram: [{ chatTitle: 'Youth Group', removed: false, reason: 'not_admin' }],
    });

    const res = await deleteAccount('my-password');

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.telegram).toHaveLength(1);
      expect(res.telegram[0].removed).toBe(false);
      expect(res.telegram[0].chatTitle).toBe('Youth Group');
    }
  });

  test('surfaces offline without claiming the account survived or died', async () => {
    calls = [];
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });

    const res = await deleteAccount('my-password');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('OFFLINE');
  });
});
