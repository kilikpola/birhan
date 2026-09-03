import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64ToBytes } from './base64';
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
 * The versionCode of the binary that is actually running.
 *
 * Read from the installed package first, and only then from app.json. Those two
 * disagree more often than one would like: app.json is a build *input*, and
 * `assembleRelease` does not re-run prebuild, so a bumped app.json can sit in a
 * binary that was compiled from the older android/app/build.gradle. When they
 * disagree, app.json is the number that is wrong, and trusting it makes the app
 * believe it is newer than it is — so it never offers the update that would fix
 * it. The package manager cannot be out of date about itself.
 */
export function getCurrentVersionCode(): number {
  const buildVer = Application.nativeBuildVersion;
  if (buildVer) {
    const parsed = parseInt(buildVer, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  if (Constants.expoConfig?.android?.versionCode) {
    return Constants.expoConfig.android.versionCode;
  }
  return 1; // Only reached in dev, where there is no installed package.
}

/** The versionName of the running binary, for display ("1.0.7"). */
export function getCurrentVersionName(): string {
  return (
    Application.nativeApplicationVersion ||
    Constants.expoConfig?.version ||
    '0.0.0'
  );
}

/**
 * How long to wait between unattended checks. A manual check ignores this
 * entirely — see `checkForApkUpdate({ force: true })`.
 */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** When the last *completed* check happened, or null if there has never been one. */
export async function getLastCheckTime(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_APK_CHECK_KEY);
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Checks if 24 hours have passed since the last APK manifest check.
 */
export async function shouldCheckApkUpdate(): Promise<boolean> {
  const last = await getLastCheckTime();
  if (last === null) return true;
  return Date.now() - last >= CHECK_INTERVAL_MS;
}

/** Why a check produced no answer. Never conflate these with "up to date". */
export type ApkCheckFailure =
  | 'offline'      // the request never completed
  | 'server'       // the server answered, but not with a manifest
  | 'malformed'    // it answered with something that is not a usable manifest
  | 'bad-url';     // refused before asking — not HTTPS, or a raw IP

/**
 * The outcome of a check.
 *
 * This is a union rather than `ApkUpdateInfo | null` on purpose. The old
 * signature returned null for six different situations — throttled, offline,
 * a 404, malformed JSON, a non-HTTPS apkUrl, and genuinely-up-to-date — so the
 * screen could not tell "we could not ask" from "there is nothing to install",
 * and showed the reassuring one either way.
 */
export type ApkCheckResult =
  | { status: 'update-available'; info: ApkUpdateInfo; checkedAt: number }
  | { status: 'up-to-date'; manifest: ApkManifest; checkedAt: number }
  | { status: 'throttled'; lastCheckedAt: number }
  | { status: 'failed'; reason: ApkCheckFailure };

/**
 * Asks the update server what the newest build is.
 *
 * Never throws, and never blocks: callers fire it and render whatever comes
 * back. `force` skips the 24-hour throttle — that is what the Settings button
 * uses, and it is the only way a user can make the app look.
 */
export async function checkForApkUpdate(
  options: { force?: boolean; manifestUrl?: string } = {}
): Promise<ApkCheckResult> {
  const { force = false, manifestUrl = DEFAULT_MANIFEST_URL } = options;

  if (!isValidHttpsUrl(manifestUrl)) {
    reportError(
      new Error(`Refusing invalid or non-HTTPS manifest URL: ${manifestUrl}`),
      'ApkUpdates.checkForApkUpdate',
      'am',
      false
    );
    return { status: 'failed', reason: 'bad-url' };
  }

  if (!force) {
    const last = await getLastCheckTime();
    if (last !== null && Date.now() - last < CHECK_INTERVAL_MS) {
      return { status: 'throttled', lastCheckedAt: last };
    }
  }

  let response: Response;
  try {
    response = await fetch(manifestUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    // A failed request is not an answer, and must not be recorded as a check —
    // otherwise one flaky moment buys 24 hours of silence.
    reportError(err, 'ApkUpdates.checkForApkUpdate.fetch', 'am', false);
    return { status: 'failed', reason: 'offline' };
  }

  if (!response.ok) {
    reportError(
      new Error(`Update manifest returned HTTP ${response.status}`),
      'ApkUpdates.checkForApkUpdate.status',
      'am',
      false
    );
    return { status: 'failed', reason: 'server' };
  }

  let manifest: ApkManifest;
  try {
    manifest = await response.json();
  } catch (err) {
    reportError(err, 'ApkUpdates.checkForApkUpdate.parse', 'am', false);
    return { status: 'failed', reason: 'malformed' };
  }

  // Validate before recording the check, so a broken manifest does not silence
  // the next 24 hours' worth of attempts.
  if (!manifest || typeof manifest.versionCode !== 'number') {
    reportError(
      new Error('Update manifest has no numeric versionCode'),
      'ApkUpdates.checkForApkUpdate.validate',
      'am',
      false
    );
    return { status: 'failed', reason: 'malformed' };
  }

  if (!isValidHttpsUrl(manifest.apkUrl)) {
    reportError(
      new Error(`Manifest contained invalid or non-HTTPS apkUrl: ${manifest.apkUrl}`),
      'ApkUpdates.checkForApkUpdate.apkUrl',
      'am',
      false
    );
    return { status: 'failed', reason: 'malformed' };
  }

  const checkedAt = Date.now();
  try {
    await AsyncStorage.setItem(LAST_APK_CHECK_KEY, checkedAt.toString());
  } catch {
    // Losing the timestamp only costs an extra check later.
  }

  const currentCode = getCurrentVersionCode();
  // Integer comparison on versionCode. Deliberately never versionName, which is
  // a display string where "1.0.10" sorts below "1.0.9".
  const isUpdateAvailable = manifest.versionCode > currentCode;
  const isUnsupported = manifest.minSupportedVersionCode > currentCode;
  const isMandatory = Boolean(manifest.mandatory) || isUnsupported;

  if (!isUpdateAvailable) {
    return { status: 'up-to-date', manifest, checkedAt };
  }

  return {
    status: 'update-available',
    info: { manifest, isUpdateAvailable, isMandatory, isUnsupported },
    checkedAt,
  };
}

/**
 * Bytes read per round trip when hashing. A multiple of 3 so each chunk is a
 * whole number of base64 groups.
 */
const HASH_CHUNK_BYTES = 3 * 1024 * 1024;

/**
 * SHA-256 of a file's contents.
 *
 * Two things here are load-bearing. It hashes the *bytes* of the file, not the
 * base64 text those bytes arrive in — the previous version hashed the text,
 * which cannot equal the digest in the manifest, so verification failed for
 * every download ever attempted and the APK was deleted as "corrupt" each time.
 * And it reads in chunks: the APK is ~150 MB, and pulling that into a single JS
 * string as base64 costs roughly 200 MB of heap before hashing even starts.
 */
export async function computeFileSha256(fileUri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) throw new Error(`Cannot hash missing file: ${fileUri}`);

  const total = info.size ?? 0;
  const hasher = sha256.create();

  for (let position = 0; position < total; position += HASH_CHUNK_BYTES) {
    const length = Math.min(HASH_CHUNK_BYTES, total - position);
    const chunk = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    });
    hasher.update(base64ToBytes(chunk));
  }

  return Array.from(hasher.digest())
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Downloads APK with progress callback and SHA-256 checksum verification.
 * Automatically deletes file and throws error if hash check fails.
 */
export async function downloadAndVerifyApk(
  manifest: ApkManifest,
  onProgress?: (progressPercent: number, downloadedBytes: number) => void,
  /**
   * Called once the bytes are all down and hashing starts. Hashing ~150 MB is
   * not instant, and without this the progress bar sits at 100% looking hung.
   */
  onVerifying?: () => void
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
    onVerifying?.();
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
    onVerifying?.();
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
