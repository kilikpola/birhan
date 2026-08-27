import { apiFetch, ApiError, OfflineError } from './api';
import { t, type Lang } from '../i18n';

/**
 * Deleting your own account, and living with what it leaves behind.
 */

/**
 * What the backend writes into `replies.author_name` for a deleted author.
 *
 * Must match DELETED_AUTHOR_SENTINEL in
 * backend/src/services/account-deletion.ts. It is a sentinel rather than a
 * translated string because the server has no idea which language the person
 * reading the thread has chosen — the translation belongs here.
 */
export const DELETED_AUTHOR = '__deleted__';

/**
 * The name to show against a reply. Anonymises deleted authors without leaving
 * a raw sentinel on screen.
 */
export function displayAuthorName(name: string | null | undefined, lang: Lang): string {
  if (!name || name === DELETED_AUTHOR) return t(lang, 'deletedUser');
  return name;
}

/** One church group Birhan tried to remove the person from. */
export type TelegramRemoval = {
  /** The group's title if Birhan recorded one. Never another person's details. */
  chatTitle: string | null;
  removed: boolean;
  reason?: 'not_admin' | 'disabled' | 'failed';
};

export type DeleteAccountResult =
  | { ok: true; telegram: TelegramRemoval[] }
  | { ok: false; code: 'WRONG_PASSWORD' | 'OFFLINE' | 'UNKNOWN'; message: string };

/**
 * Deletes the signed-in account. Irreversible.
 *
 * Takes the password rather than relying on the session alone: a session is
 * whatever is sitting unlocked in someone's hand, and this is not a mistake
 * anybody can undo. The server checks it again — this is not a client-side gate.
 *
 * A `telegram` array comes back even on success, listing the groups that could
 * and could not be updated. A Telegram failure never means the account survived.
 */
export async function deleteAccount(password: string): Promise<DeleteAccountResult> {
  try {
    const res = await apiFetch<{ deleted: true; telegram: TelegramRemoval[] }>('/api/v1/me', {
      method: 'DELETE',
      body: { password },
    });
    return { ok: true, telegram: res.telegram ?? [] };
  } catch (err) {
    if (err instanceof ApiError) {
      // The only 401 this endpoint returns is a bad password — the request
      // carried a valid session or it would not have reached the handler.
      if (err.status === 401) {
        return { ok: false, code: 'WRONG_PASSWORD', message: err.message };
      }
      return { ok: false, code: 'UNKNOWN', message: err.message };
    }
    if (err instanceof OfflineError) return { ok: false, code: 'OFFLINE', message: 'offline' };
    return { ok: false, code: 'UNKNOWN', message: 'unknown' };
  }
}
