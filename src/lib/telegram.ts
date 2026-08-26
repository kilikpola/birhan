import { apiFetch, ApiError } from './api';

export type TelegramLinkStatus = {
  isLinked: boolean;
  chatId: string | null;
  chatTitle: string | null;
  verifiedAt: string | null;
};

export type TelegramCodeResult = {
  code?: string;
  expiresAt?: Date;
  error?: string;
};

/**
 * Requests a short-lived link code from the backend (POST /telegram/link-code).
 * The church and requesting user are both derived server-side from the JWT —
 * never accepted from the client — so this takes no arguments.
 */
export async function generateTelegramLinkCode(): Promise<TelegramCodeResult> {
  try {
    const res = await apiFetch<{ code: string; expiresAt: string }>('/api/v1/telegram/link-code', {
      method: 'POST',
    });
    return { code: res.code, expiresAt: new Date(res.expiresAt) };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Failed to generate a link code' };
  }
}

/**
 * Gets Telegram group link status for the caller's own church.
 */
export async function getTelegramLinkStatus(): Promise<TelegramLinkStatus> {
  try {
    return await apiFetch<TelegramLinkStatus>('/api/v1/telegram/status');
  } catch {
    return { isLinked: false, chatId: null, chatTitle: null, verifiedAt: null };
  }
}

/**
 * Unlinks the caller's church's Telegram group.
 */
export async function unlinkTelegramGroup(): Promise<{ error?: string }> {
  try {
    await apiFetch('/api/v1/telegram/link', { method: 'DELETE' });
    return {};
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Failed to unlink' };
  }
}

/**
 * Mirrors an already-published announcement into the linked Telegram group.
 * Always resolves (never throws on delivery failure) — the announcement is
 * already published either way, and the app offers a retry instead of an error.
 */
export async function postAnnouncementToTelegram(payload: {
  announcementId: string;
  churchId: string;
  title?: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch<{ success: boolean; error?: string; detail?: string }>(
      `/api/v1/telegram/announcements/${payload.announcementId}`,
      { method: 'POST' },
    );
    if (res.success) return { success: true };
    return { success: false, error: res.detail || res.error || 'Failed to send to Telegram' };
  } catch (err) {
    return { success: false, error: err instanceof ApiError ? err.message : 'Failed to send to Telegram' };
  }
}
