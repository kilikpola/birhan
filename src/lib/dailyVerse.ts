import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type * as SQLite from 'expo-sqlite';
import { getNotificationsModule, ensureNotificationPermission } from './push';
import { getVerseForDate } from './verseOfDay';
import { reportError } from './errors';
import { t, Lang } from '../i18n';

/**
 * Daily verse reminder — a scheduled LOCAL notification, one per day, carrying
 * that day's verse of the day. Entirely on-device: it needs no server, no EAS
 * projectId and no FCM, and works offline, because the verse is already resolved
 * from the bundled Bible.
 *
 * expo-notifications' DATE triggers fire once, so a repeating daily reminder
 * with ROTATING content is built by scheduling the next few days as individual
 * dated notifications and re-syncing whenever the app is opened. That keeps the
 * window rolling forward and means a phone that is opened at least once a week
 * always has upcoming reminders queued, each with the correct verse.
 */

export const PREF_DAILY_VERSE = 'birhan:daily_verse_enabled';
const DAILY_VERSE_CHANNEL = 'daily_verse';
const HOUR = 7; // 7:00 local
const DAYS_AHEAD = 7;
const DATA_TYPE = 'daily_verse';

type Notifications = NonNullable<ReturnType<typeof getNotificationsModule>>;

/** Default ON — but nothing actually fires until permission is granted. */
export async function isDailyVerseEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PREF_DAILY_VERSE);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

async function ensureChannel(N: Notifications) {
  if (Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync(DAILY_VERSE_CHANNEL, {
    name: 'Daily verse',
    importance: N.AndroidImportance.DEFAULT,
    lightColor: '#E3A93C',
  });
}

/** Remove only our own scheduled daily-verse notifications, nothing else. */
async function cancelExisting(N: Notifications) {
  const all = await N.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((s) => (s.content?.data as { type?: string } | undefined)?.type === DATA_TYPE)
      .map((s) => N.cancelScheduledNotificationAsync(s.identifier)),
  );
}

/**
 * Reconcile the scheduled daily-verse notifications with the current setting.
 * Safe to call on every app open — it cancels the old set and re-queues the
 * next {@link DAYS_AHEAD} days. A no-op in Expo Go or when the module is absent.
 */
export async function syncDailyVerseNotifications(
  bibleDb: SQLite.SQLiteDatabase,
  lang: Lang,
): Promise<void> {
  try {
    const N = getNotificationsModule();
    if (!N) return;

    if (!(await isDailyVerseEnabled())) {
      await cancelExisting(N);
      return;
    }

    const granted = await ensureNotificationPermission();
    if (!granted) return;

    await ensureChannel(N);
    await cancelExisting(N);

    const isAm = lang === 'am';
    const now = new Date();
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const when = new Date(now);
      when.setDate(now.getDate() + i);
      when.setHours(HOUR, 0, 0, 0);
      if (when.getTime() <= Date.now()) continue; // today's slot already passed

      const verse = await getVerseForDate(bibleDb, when);
      if (!verse) continue;

      await N.scheduleNotificationAsync({
        content: {
          title: t(lang, 'dailyVerseTitle'),
          body: `${isAm ? verse.text_am : verse.text_en}\n— ${isAm ? verse.ref_am : verse.ref_en}`,
          data: { type: DATA_TYPE },
        },
        trigger: {
          type: N.SchedulableTriggerInputTypes.DATE,
          date: when,
          ...(Platform.OS === 'android' ? { channelId: DAILY_VERSE_CHANNEL } : {}),
        },
      });
    }
  } catch (err) {
    reportError(err, 'dailyVerse.sync', lang, false);
  }
}

/** Flip the setting and re-sync immediately. */
export async function setDailyVerseEnabled(
  enabled: boolean,
  bibleDb: SQLite.SQLiteDatabase,
  lang: Lang,
): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_DAILY_VERSE, enabled ? '1' : '0');
  } catch {
    // A failed write just means the default (on) stands next launch.
  }
  await syncDailyVerseNotifications(bibleDb, lang);
}
