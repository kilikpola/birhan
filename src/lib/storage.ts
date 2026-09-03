import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

/**
 * What Birhan is using on the phone, and what of it is safe to throw away.
 *
 * The distinction that matters here is between the offline library and
 * everything else. The scripture and study databases are the reason the app
 * works with the radio off; deleting them to save space would quietly break
 * the one promise the app makes. So "clear cached data" never touches them —
 * it clears the scratch directory and any finished update download, which are
 * both re-obtainable and neither of which is needed again.
 */

export type StorageBreakdown = {
  /** Scripture + study databases. Not clearable. */
  libraryBytes: number;
  /** Church documents the user downloaded. Not clearable from here — each has
   *  its own delete on the Resources screen. */
  resourcesBytes: number;
  /** Scratch files and leftover update APKs. Clearable. */
  cacheBytes: number;
  totalBytes: number;
};

/**
 * expo-file-system's legacy API addresses files by `file://` URI, but
 * `SQLite.defaultDatabaseDirectory` is a bare filesystem path — on Android it
 * is literally `context.filesDir + "/SQLite"`. Passing that through unchanged
 * makes every getInfoAsync report the file as missing, silently, which reads
 * as "0 bytes" or "not downloaded" rather than as an error.
 */
export function toFileUri(path: string): string {
  if (!path) return path;
  return /^[a-z]+:\/\//i.test(path) ? path : `file://${path}`;
}

const dirOf = (base: string | null, name: string) => {
  const b = base || '';
  return b.endsWith('/') ? `${b}${name}/` : `${b}/${name}/`;
};

/** Sum of every regular file under `dir`, recursing. Missing dir counts as 0. */
async function dirSize(dir: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return 0;
    if (!info.isDirectory) return info.size ?? 0;

    const names = await FileSystem.readDirectoryAsync(dir);
    let total = 0;
    for (const name of names) {
      const child = dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
      const childInfo = await FileSystem.getInfoAsync(child);
      if (!childInfo.exists) continue;
      total += childInfo.isDirectory ? await dirSize(child) : (childInfo.size ?? 0);
    }
    return total;
  } catch {
    // A directory we cannot read contributes nothing rather than failing the
    // whole figure — a settings screen must not break over a permissions edge.
    return 0;
  }
}

/** Leftover `birhan_update_v*.apk` files from a completed or abandoned update. */
async function updateApkUris(): Promise<string[]> {
  const doc = FileSystem.documentDirectory;
  if (!doc) return [];
  try {
    const names = await FileSystem.readDirectoryAsync(doc);
    return names
      .filter((n) => /^birhan_update_v\d+\.apk$/.test(n))
      .map((n) => `${doc}${n}`);
  } catch {
    return [];
  }
}

export async function getStorageBreakdown(): Promise<StorageBreakdown> {
  const libraryBytes = await dirSize(toFileUri(SQLite.defaultDatabaseDirectory));
  const resourcesBytes = await dirSize(dirOf(FileSystem.documentDirectory, 'resources'));

  let cacheBytes = await dirSize(FileSystem.cacheDirectory ?? '');
  for (const uri of await updateApkUris()) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && !info.isDirectory) cacheBytes += info.size ?? 0;
  }

  return {
    libraryBytes,
    resourcesBytes,
    cacheBytes,
    totalBytes: libraryBytes + resourcesBytes + cacheBytes,
  };
}

/**
 * Deletes the scratch directory's contents and any finished update download.
 * Never touches the databases or downloaded church documents.
 *
 * Returns the number of bytes reclaimed, so the screen can say what it did.
 */
export async function clearCachedData(): Promise<number> {
  const before = await getStorageBreakdown();

  const cache = FileSystem.cacheDirectory;
  if (cache) {
    try {
      const names = await FileSystem.readDirectoryAsync(cache);
      for (const name of names) {
        await FileSystem.deleteAsync(`${cache}${name}`, { idempotent: true }).catch(() => {});
      }
    } catch {
      // Nothing to clear, or unreadable. Either way there is no failure to report.
    }
  }

  for (const uri of await updateApkUris()) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }

  const after = await getStorageBreakdown();
  return Math.max(0, before.totalBytes - after.totalBytes);
}

/** "1.2 GB" / "77 MB" / "840 KB" / "0 MB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
