import Constants from 'expo-constants';

/**
 * Local notifications — the daily-verse reminder is the only one the app
 * sends. Nothing here talks to a server.
 *
 * IMPORTANT — Expo Go: `expo-notifications` THROWS the moment it is imported
 * there (SDK 53+). So we never load it statically. It is lazy-required behind
 * an environment check, and every entry point fails safe by returning null.
 * The offline Bible must never be blocked by notifications being unavailable.
 */

// Expo Go reports appOwnership 'expo' / executionEnvironment 'storeClient'.
const isExpoGo =
  Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';

// Lazily-loaded expo-notifications module (null in Expo Go or if unavailable).
let notificationsModule: typeof import('expo-notifications') | null | undefined;

function getNotifications(): typeof import('expo-notifications') | null {
  if (notificationsModule !== undefined) return notificationsModule;
  if (isExpoGo) {
    notificationsModule = null;
    return null;
  }
  try {
    // Required lazily so the module is never evaluated under Expo Go.
    const mod = require('expo-notifications') as typeof import('expo-notifications');
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    notificationsModule = mod;
  } catch {
    notificationsModule = null;
  }
  return notificationsModule;
}

/**
 * The lazily-loaded expo-notifications module, or null when unavailable (Expo
 * Go, or a build without it).
 */
export function getNotificationsModule(): typeof import('expo-notifications') | null {
  return getNotifications();
}

/**
 * Ask for notification permission for local notifications (the daily verse).
 * Local notifications fire on emulators too, so this only gates on the module
 * and the permission grant. Returns whether notifications may be shown.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  return status === 'granted';
}
