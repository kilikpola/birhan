import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isNetworkAllowedForDownload } from './otaUpdates';
import { reportError } from './errors';

export const DEFAULT_MANIFEST_URL = 'https://updates.birhan.online/birhan/latest.json';
export const LAST_APK_CHECK_KEY = 'birhan:last_apk_update_check';

export type ApkManifest = {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  releasedAt: string;
  minSupportedVersionCode: number;
  notes_am: string;
  notes_en: string;
  mandatory: boolean;
};

export type ApkUpdateInfo = {
  manifest: ApkManifest;
  isUpdateAvailable: boolean;
  isMandatory: boolean;
  isUnsupported: boolean;
};

let activeDownloadResumable: FileSystem.DownloadResumable | null = null;

/**
 * Validates that a given URL string uses strict HTTPS and is not a raw IP.
 * Refuses plain HTTP or raw IP addresses.
 */
export function isValidHttpsUrl(urlString: string): boolean {
  if (!urlString || typeof urlString !== 'string') return false;
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'https:') return false;
    // Reject raw IPv4 / IPv6 addresses
    const host = url.hostname;
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
    const isIpv6 = /^\[?[a-fA-F0-9:]+\]?$/.test(host);
    if (isIpv4 || isIpv6) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns current installed application's versionCode.
 */
export function getCurrentVersionCode(): number {
  if (Constants.expoConfig?.android?.versionCode) {
    return Constants.expoConfig.android.versionCode;
  }
  const buildVer = Application.nativeBuildVersion;
  if (buildVer) {
    const parsed = parseInt(buildVer, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 1; // Default fallback for dev environment
}

/**
 * Checks if 24 hours have passed since the last APK manifest check.
 */
export async function shouldCheckApkUpdate(): Promise<boolean> {
  try {
    const lastCheckStr = await AsyncStorage.getItem(LAST_APK_CHECK_KEY);
    if (!lastCheckStr) return true;
    const lastCheckTime = parseInt(lastCheckStr, 10);
    if (isNaN(lastCheckTime)) return true;
    const now = Date.now();
    const elapsedMs = now - lastCheckTime;
    return elapsedMs >= 24 * 60 * 60 * 1000; // 24 hours
  } catch {
    return true;
  }
}

/**
 * Fetches the APK update manifest from the specified HTTPS URL.
 * Rate-limited to at most once per 24 hours unless forceCheck is true.
 * Never throws — returns null if unreachable or invalid.
 */
export async function fetchApkManifest(
  manifestUrl: string = DEFAULT_MANIFEST_URL,
  forceCheck: boolean = false
): Promise<ApkUpdateInfo | null> {
  if (!isValidHttpsUrl(manifestUrl)) {
    console.warn(`[APKUpdate] Refusing invalid or non-HTTPS URL: ${manifestUrl}`);
    return null;
  }

  if (!forceCheck) {
    const shouldCheck = await shouldCheckApkUpdate();
    if (!shouldCheck) return null;
  }

  try {
    const response = await fetch(manifestUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const manifest: ApkManifest = await response.json();

    // Store last check timestamp
    await AsyncStorage.setItem(LAST_APK_CHECK_KEY, Date.now().toString());

    if (!manifest || typeof manifest.versionCode !== 'number') return null;

    // Validate inner apkUrl is also strictly HTTPS
    if (!isValidHttpsUrl(manifest.apkUrl)) {
      console.warn(`[APKUpdate] Manifest contained invalid or non-HTTPS apkUrl: ${manifest.apkUrl}`);
      return null;
    }

    const currentCode = getCurrentVersionCode();
    const isUpdateAvailable = manifest.versionCode > currentCode;
    const isUnsupported = manifest.minSupportedVersionCode > currentCode;
    const isMandatory = manifest.mandatory || isUnsupported;

    return {
      manifest,
      isUpdateAvailable,
      isMandatory,
      isUnsupported,
    };
  } catch (err) {
    // Non-blocking log — app continues normally
    reportError(err, 'ApkUpdates.fetchApkManifest', 'am', false);
    return null;
  }
}

/**
 * Computes the SHA-256 hash of a local file.
 */
export async function computeFileSha256(fileUri: string): Promise<string> {
  const content = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    content
  );
  return hash.toLowerCase();
}

/**
 * Downloads APK with progress callback and SHA-256 checksum verification.
 * Automatically deletes file and throws error if hash check fails.
 */
export async function downloadAndVerifyApk(
  manifest: ApkManifest,
  onProgress?: (progressPercent: number, downloadedBytes: number) => void
): Promise<{ fileUri: string }> {
  if (!isValidHttpsUrl(manifest.apkUrl)) {
    throw new Error('APK URL is invalid or not HTTPS.');
  }

  const targetFilename = `birhan_update_v${manifest.versionCode}.apk`;
  const destinationUri = `${FileSystem.documentDirectory}${targetFilename}`;

  // Check existing file
  const fileInfo = await FileSystem.getInfoAsync(destinationUri);
  if (fileInfo.exists) {
    // Check hash of existing file
    const existingHash = await computeFileSha256(destinationUri);
    if (existingHash.toLowerCase() === manifest.sha256.toLowerCase()) {
      return { fileUri: destinationUri };
    } else {
      // Stale or corrupted — delete
      await FileSystem.deleteAsync(destinationUri, { idempotent: true });
    }
  }

  activeDownloadResumable = FileSystem.createDownloadResumable(
    manifest.apkUrl,
    destinationUri,
    {},
    (downloadProgress) => {
      if (downloadProgress.totalBytesExpectedToWrite > 0 && onProgress) {
        const percent = Math.floor(
          (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100
        );
        onProgress(percent, downloadProgress.totalBytesWritten);
      }
    }
  );

  try {
    const result = await activeDownloadResumable.downloadAsync();
    activeDownloadResumable = null;

    if (!result || !result.uri) {
      throw new Error('APK download failed: empty result.');
    }

    // SHA-256 Hash Verification (SECURITY REQUIREMENT)
    const computedHash = await computeFileSha256(result.uri);
    if (computedHash.toLowerCase() !== manifest.sha256.toLowerCase()) {
      // SECURITY VIOLATION: Delete invalid file immediately
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
      throw new Error(
        `SHA-256 hash mismatch! Expected ${manifest.sha256}, calculated ${computedHash}. File deleted.`
      );
    }

    return { fileUri: result.uri };
  } catch (err) {
    activeDownloadResumable = null;
    // Ensure incomplete file is removed
    await FileSystem.deleteAsync(destinationUri, { idempotent: true }).catch(() => {});
    throw err;
  }
}

/**
 * Cancels any active download in progress.
 */
export async function cancelApkDownload(): Promise<void> {
  if (activeDownloadResumable) {
    try {
      await activeDownloadResumable.cancelAsync();
    } catch {
      // ignore
    } finally {
      activeDownloadResumable = null;
    }
  }
}

/**
 * Launches the Android Intent to install the verified downloaded APK.
 */
export async function launchApkInstaller(fileUri: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
