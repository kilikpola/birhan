import { apiFetch, ApiError, OfflineError } from './api';

/**
 * The client half of "prove you control a Telegram account before we make you
 * one here".
 *
 * Worth being explicit about what is deliberately absent: there is no function
 * in this file that marks a registration connected. The app can start the
 * handshake and it can ask what the server found, and that is the whole
 * surface. Connectedness is asserted by the backend's webhook, from an update
 * Telegram itself delivered — if the app could set it, the check would be
 * checking the party it is meant to be checking on.
 *
 * See backend/src/services/telegram-signup.ts for the other side.
 */

export type PendingRegistration = {
  pendingId: string;
  /** https://t.me/<bot>?start=<token> — built by the server from its own config. */
  deepLink: string;
  expiresAt: string;
};

/**
 * Everything the account will be made from, handed over in one go so the
 * server can hold it while the user is away in Telegram.
 */
export type StartRegistrationBody = {
  email?: string;
  phone?: string;
  password: string;
  displayName: string;
  churchId: string;
  branchId?: string | null;
  churchRole?: string | null;
  language: 'am' | 'en';
};

export type StartResult =
  | { ok: true; pending: PendingRegistration }
  | { ok: false; code: string; message: string };

export async function startTelegramRegistration(
  body: StartRegistrationBody,
): Promise<StartResult> {
  try {
    const pending = await apiFetch<PendingRegistration>('/api/v1/auth/telegram/start', {
      method: 'POST',
      body,
      auth: false,
    });
    return { ok: true, pending };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message };
    if (err instanceof OfflineError) return { ok: false, code: 'OFFLINE', message: 'offline' };
    return { ok: false, code: 'UNKNOWN', message: 'unknown' };
  }
}

/**
 * The server's own view of a pending registration.
 *
 * `offline` is a client-side state, not something the endpoint returns — it
 * means the poll itself failed, which must never be mistaken for "Telegram
 * said no".
 */
export type TelegramStatus =
  | { status: 'waiting'; expiresAt: string }
  | { status: 'connected'; telegramUsername: string | null; expiresAt: string }
  | { status: 'already_linked' }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'consumed' }
  | { status: 'offline' };

export async function getTelegramRegistrationStatus(
  pendingId: string,
): Promise<TelegramStatus> {
  try {
    return await apiFetch<TelegramStatus>(
      `/api/v1/auth/telegram/status?pendingRegistrationId=${encodeURIComponent(pendingId)}`,
      { auth: false },
    );
  } catch (err) {
    // A failed poll is not an answer. Keep waiting rather than telling someone
    // their registration failed because their bus went through a tunnel.
    if (err instanceof OfflineError) return { status: 'offline' };
    if (err instanceof ApiError && err.status >= 500) return { status: 'offline' };
    return { status: 'offline' };
  }
}
