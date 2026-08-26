import { supabase } from './supabase';

export type TelegramLinkStatus = {
  isLinked: boolean;
  chatId: string | null;
  verifiedAt: string | null;
};

export type TelegramCodeResult = {
  code?: string;
  expiresAt?: Date;
  error?: string;
};

/**
 * Generates a short 6-character random link code (e.g. BIRHAN-4F2K) valid for 10 minutes.
 * Saved in telegram_link_codes table with church_id, created_by, and expires_at.
 */
export async function generateTelegramLinkCode(
  churchId: string,
  userId: string
): Promise<TelegramCodeResult> {
  try {
    const randomChars = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `BIRHAN-${randomChars}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10-minute expiry

    const { error } = await supabase.from('telegram_link_codes').insert({
      church_id: churchId,
      code,
      created_by: userId,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      return { error: error.message };
    }

    return { code, expiresAt };
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

/**
 * Gets Telegram group link status for a church.
 */
export async function getTelegramLinkStatus(churchId: string): Promise<TelegramLinkStatus> {
  try {
    const { data, error } = await supabase
      .from('churches')
      .select('telegram_chat_id, telegram_verified_at')
      .eq('id', churchId)
      .maybeSingle();

    if (error || !data) {
      return { isLinked: false, chatId: null, verifiedAt: null };
    }

    const isLinked = Boolean(data.telegram_chat_id && data.telegram_verified_at);
    return {
      isLinked,
      chatId: data.telegram_chat_id || null,
      verifiedAt: data.telegram_verified_at || null,
    };
  } catch {
    return { isLinked: false, chatId: null, verifiedAt: null };
  }
}

/**
 * Unlinks a church's Telegram group by clearing telegram_chat_id and telegram_verified_at.
 */
export async function unlinkTelegramGroup(churchId: string): Promise<{ error?: string }> {
  try {
    const { error } = await supabase
      .from('churches')
      .update({
        telegram_chat_id: null,
        telegram_verified_at: null,
      })
      .eq('id', churchId);

    if (error) return { error: error.message };
    return {};
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

/**
 * Dispatches an announcement to Telegram via post-telegram-announcement Edge Function.
 * Returns success boolean and error message if Telegram post fails.
 */
export async function postAnnouncementToTelegram(payload: {
  announcementId: string;
  churchId: string;
  title?: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('post-telegram-announcement', {
      body: payload,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (data?.posted || data?.ok) {
      return { success: true };
    }

    return { success: false, error: data?.error || 'Failed to send to Telegram' };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}
