/**
 * The client half of the registration handshake, pinned against the contract
 * the backend actually implements.
 *
 * These tests exist for one reason: the app and the backend agree about this
 * flow only by convention, and the convention is load-bearing. If the path, the
 * body shape, or the status vocabulary drifts on either side, registration
 * breaks in a way that type-checking cannot see. The backend's own suite
 * (backend/tests/telegram-registration.test.ts) exercises the same paths and
 * the same status strings from the other direction.
 *
 * The second reason is narrower and more important: there must be no way for
 * this module to report "connected" that does not come from the server.
 */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

import {
  startTelegramRegistration,
  getTelegramRegistrationStatus,
} from '../src/lib/telegramSignup';

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

const DETAILS = {
  email: 'abebe@example.com',
  password: 'a-good-long-password',
  displayName: 'Abebe',
  churchId: '11111111-1111-4111-8111-111111111111',
  branchId: null,
  churchRole: 'member',
  language: 'am' as const,
};

describe('starting a registration', () => {
  test('posts the details to the endpoint the backend serves', async () => {
    mockFetch(200, {
      pendingId: 'p-1',
      deepLink: 'https://t.me/BirhanBot?start=abc',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });

    const res = await startTelegramRegistration(DETAILS);

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.birhan.test/api/v1/auth/telegram/start');
    expect(calls[0].init.method).toBe('POST');

    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.email).toBe('abebe@example.com');
    expect(sent.churchId).toBe(DETAILS.churchId);
    expect(sent.language).toBe('am');
  });

  test('sends no Authorization header — the user has no account yet', async () => {
    mockFetch(200, { pendingId: 'p-1', deepLink: 'https://t.me/B?start=a', expiresAt: 'x' });
    await startTelegramRegistration(DETAILS);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  test('surfaces a refusal with its code rather than throwing', async () => {
    mockFetch(409, { error: { code: 'CONFLICT', message: 'Email already in use' } });

    const res = await startTelegramRegistration(DETAILS);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('CONFLICT');
      expect(res.message).toBe('Email already in use');
    }
  });

  test('reports a server that has Telegram switched off', async () => {
    mockFetch(503, {
      error: { code: 'TELEGRAM_DISABLED', message: 'Registration is temporarily unavailable.' },
    });

    const res = await startTelegramRegistration(DETAILS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('TELEGRAM_DISABLED');
  });
});

describe('asking what the server found', () => {
  test('queries by pending id on the endpoint the backend serves', async () => {
    mockFetch(200, { status: 'waiting', expiresAt: '2030-01-01T00:00:00.000Z' });

    const res = await getTelegramRegistrationStatus('p-1');

    expect(res.status).toBe('waiting');
    expect(calls[0].url).toBe(
      'https://api.birhan.test/api/v1/auth/telegram/status?pendingRegistrationId=p-1',
    );
  });

  test('passes through every state the backend can report', async () => {
    for (const status of ['waiting', 'connected', 'already_linked', 'expired', 'consumed', 'not_found']) {
      mockFetch(200, { status, telegramUsername: 'abebe', expiresAt: 'x' });
      const res = await getTelegramRegistrationStatus('p-1');
      expect(res.status).toBe(status);
    }
  });

  test('carries the username through so the UI can show who connected', async () => {
    mockFetch(200, { status: 'connected', telegramUsername: 'abebe', expiresAt: 'x' });
    const res = await getTelegramRegistrationStatus('p-1');
    expect(res.status).toBe('connected');
    if (res.status === 'connected') expect(res.telegramUsername).toBe('abebe');
  });

  test('a failed poll reports offline, never connected', async () => {
    calls = [];
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });

    const res = await getTelegramRegistrationStatus('p-1');
    expect(res.status).toBe('offline');
  });

  test('a server error reports offline, never connected', async () => {
    mockFetch(500, { error: { code: 'INTERNAL', message: 'boom' } });
    const res = await getTelegramRegistrationStatus('p-1');
    expect(res.status).toBe('offline');
  });

  test('a refusal is never silently upgraded to connected', async () => {
    for (const status of [400, 404, 429, 500, 503]) {
      mockFetch(status, { error: { code: 'NOPE', message: 'no' } });
      const res = await getTelegramRegistrationStatus('p-1');
      expect(res.status).not.toBe('connected');
    }
  });
});
