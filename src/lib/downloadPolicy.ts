import * as Network from 'expo-network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from './errors';

/**
 * When Birhan is allowed to pull something large down.
 *
 * Two things are large enough to matter: the APK for an update, and the
 * optional patristic commentary. Both ask here first. Wi-Fi is the default
 * because mobile data in Ethiopia is bought in bundles and a 150 MB surprise
 * is a real cost to someone.
 *
 * This was `otaUpdates.ts`. The expo-updates half of it is gone — the app was
 * configured against a placeholder EAS project id that is not Birhan's, so the
 * OTA path could never have delivered anything.
 */

const ALLOW_MOBILE_DATA_KEY = 'birhan:allow_mobile_data_updates';

/** Default is FALSE — Wi-Fi only until someone says otherwise. */
export async function getAllowMobileData(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ALLOW_MOBILE_DATA_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setAllowMobileData(allow: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ALLOW_MOBILE_DATA_KEY, allow ? 'true' : 'false');
  } catch (err) {
    reportError(err, 'DownloadPolicy.setAllowMobileData', 'am', false);
  }
}

/**
 * Whether a large download may start right now.
 *
 * Wi-Fi is always allowed. Cellular needs the preference above. Anything else
 * — ethernet, a tethered laptop, an emulator — is allowed, since it is not
 * metered in the way this setting exists to protect against. No connection at
 * all is not allowed, which lets the caller say "you are offline" rather than
 * starting a download that cannot finish.
 */
export async function isNetworkAllowedForDownload(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (!state.isConnected || !state.isInternetReachable) return false;
    if (state.type === Network.NetworkStateType.WIFI) return true;
    if (state.type === Network.NetworkStateType.CELLULAR) return await getAllowMobileData();
    return true;
  } catch {
    return false;
  }
}
