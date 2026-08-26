import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { reportError } from './errors';

/**
 * Push notifications — the church loop the spec is built around:
 * a pastor posts an announcement, every member's phone lights up.
 *
 * Transport is the Expo push service (which speaks FCM under the hood on
 * Android), so there is no Firebase SDK in the app. The device registers an
 * Expo push token, we store it on the member's profile, and a Supabase Edge
 * Function fans out to those tokens when an announcement is inserted.
 *
 * IMPORTANT — Expo Go: remote push was removed from Expo Go in SDK 53, and
 * `expo-notifications` THROWS the moment it is imported there. So we never load
 * it statically. It is lazy-required behind an environment check, and every
 * entry point fails safe by returning null. The offline Bible must never be
 * blocked by push being unavailable. Real push needs a dev/standalone build.
 */

export const ANNOUNCEMENT_CHANNEL = 'announcements';

// Expo Go reports appOwnership 'expo' / executionEnvironment 'storeClient'.
const isExpoGo =
  Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';

// Lazily-loaded expo-notifications module (null in Expo Go or if unavailable).
let notificationsModule: typeof import('expo-notifications') | null | undefined;
let handlerSet = false;

function getNotifications(): typeof import('expo-notifications') | null {
  if (notificationsModule !== undefined) return notificationsModule;
  if (isExpoGo) {
    notificationsModule = null;
    return null;
  }
  try {
    // Required lazily so the module is never evaluated under Expo Go.
    const mod = require('expo-notifications') as typeof import('expo-notifications');
    if (!handlerSet) {
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      handlerSet = true;
    }
    notificationsModule = mod;
  } catch {
    notificationsModule = null;
  }
  return notificationsModule;
}

async function ensureAndroidChannel(Notifications: typeof import('expo-notifications')) {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANNOUNCEMENT_CHANNEL, {
    name: 'Church announcements',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#E3A93C',
  });
}

function getProjectId(): string | undefined {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId ??
    undefined
  );
}

/**
 * Asks for permission and returns an Expo push token, or null if push isn't
 * available (Expo Go, simulator, permission denied, or no EAS projectId).
 * Never throws — a missing token must not block the offline Bible.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  const Notifications = getNotifications();
  if (!Notifications) return null; // Expo Go or module unavailable
  if (!Device.isDevice) return null; // no push on simulators/emulators
  await ensureAndroidChannel(Notifications);

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return null;

  const projectId = getProjectId();
  if (!projectId) {
    if (__DEV__) {
      console.warn('[push] No EAS projectId in app config — run `eas init`. Skipping token.');
    }
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

/**
 * NOT AVAILABLE YET — see docs/KNOWN_GAPS.md.
 *
 * The old `push_tokens` table and its Supabase RLS policy (a member can only
 * read/write their own token) don't exist in backend/ at all: no table, no
 * route, nothing under backend/src/ matches "push". The fanout itself — a
 * Supabase Edge Function triggered on new announcements — is gone too, with
 * no replacement. This isn't a call-site swap; it's a whole missing
 * subsystem (storage + fanout), so this fails honestly instead of being
 * built around. usePushNotifications() below already treats a failure here
 * as non-fatal — it reports and moves on, never blocking the offline Bible.
 */
export async function savePushToken(userId: string, token: string): Promise<void> {
  throw new Error('Push notifications are not available yet — see docs/KNOWN_GAPS.md');
}

/**
 * Registers for push once a user is signed in, stores the token, and wires
 * "tap the notification → open the announcement". Safe to mount anywhere below
 * the auth provider; a no-op in Expo Go and until there's a user id.
 */
export function usePushNotifications(
  userId: string | undefined,
  onOpenAnnouncement?: (announcementId?: string) => void,
) {
  const savedToken = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const token = await registerForPushNotifications();
        if (token && token !== savedToken.current) {
          savedToken.current = token;
          await savePushToken(userId, token);
        }
      } catch (err) {
        reportError(err, 'push.register', 'am', false);
      }
    })();
  }, [userId]);

  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return; // Expo Go — no listener to attach
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp.notification.request.content.data as { type?: string; announcement_id?: string };
      if (data?.type === 'announcement') onOpenAnnouncement?.(data.announcement_id);
    });
    return () => sub.remove();
  }, [onOpenAnnouncement]);
}
