import * as Updates from 'expo-updates';
import * as Network from 'expo-network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { reportError } from './errors';

export const ALLOW_MOBILE_DATA_KEY = 'birhan:allow_mobile_data_updates';

export type OtaUpdateState = {
  isChecking: boolean;
  isAvailable: boolean;
  isDownloaded: boolean;
  error: string | null;
};

let currentAppState = AppState.currentState;

/**
 * Reads user preference for downloading updates over mobile data.
 * Default is FALSE (Wi-Fi only).
 */
export async function getAllowMobileData(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(ALLOW_MOBILE_DATA_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

/**
 * Updates user preference for downloading updates over mobile data.
 */
export async function setAllowMobileData(allow: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ALLOW_MOBILE_DATA_KEY, allow ? 'true' : 'false');
  } catch (err) {
    reportError(err, 'OtaUpdates.setAllowMobileData', 'am', false);
  }
}

/**
 * Checks if the current network connection allows downloading.
 * Wi-Fi is always allowed. Cellular requires allowMobileData = true.
 */
export async function isNetworkAllowedForDownload(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (!state.isConnected || !state.isInternetReachable) {
      return false;
    }

    if (state.type === Network.NetworkStateType.WIFI) {
      return true;
    }

    if (state.type === Network.NetworkStateType.CELLULAR) {
      return await getAllowMobileData();
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Checks for OTA updates in the background.
 * Never throws and never blocks app launch.
 */
export async function checkAndFetchOtaUpdate(): Promise<{ available: boolean; downloaded: boolean }> {
  // If running in development (Expo Go or dev client without updates enabled), return safely.
  if (__DEV__ || !Updates.isEnabled) {
    return { available: false, downloaded: false };
  }

  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      return { available: false, downloaded: false };
    }

    const canDownload = await isNetworkAllowedForDownload();
    if (!canDownload) {
      return { available: true, downloaded: false };
    }

    const fetchResult = await Updates.fetchUpdateAsync();
    if (fetchResult.isNew) {
      return { available: true, downloaded: true };
    }

    return { available: true, downloaded: false };
  } catch (err) {
    // Non-blocking log — app launch continues normally.
    reportError(err, 'OtaUpdates.checkAndFetchOtaUpdate', 'am', false);
    return { available: false, downloaded: false };
  }
}

/**
 * Initializes automatic background OTA update checking on app launch and resume-from-background.
 */
export function initOtaUpdateListener(onUpdateReady?: () => void) {
  if (__DEV__ || !Updates.isEnabled) return () => {};

  // Check on launch asynchronously (non-blocking)
  checkAndFetchOtaUpdate().then((res) => {
    if (res.downloaded && onUpdateReady) {
      onUpdateReady();
    }
  });

  // Check on resume from background
  const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
    if (currentAppState.match(/inactive|background/) && nextState === 'active') {
      checkAndFetchOtaUpdate().then((res) => {
        if (res.downloaded && onUpdateReady) {
          onUpdateReady();
        }
      });
    }
    currentAppState = nextState;
  });

  return () => {
    subscription.remove();
  };
}
