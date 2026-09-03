import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { toFileUri } from './storage';

/**
 * Read-only data access for the three verse-study databases bundled with the
 * app (Strong's, cross-references, Matthew Henry's commentary) plus the
 * optional fourth (patristic commentary), which is never bundled — see
 * PATRISTIC_DB_URL below — and is downloaded on request instead.
 *
 * Each bundled database is copied out of the APK into the SQLite directory
 * on first use (same mechanism _layout.tsx uses for bible_v3.db), then a
 * single connection is reused for the life of the app.
 */

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`;
}

async function openBundled(filename: string, assetId: number): Promise<SQLite.SQLiteDatabase> {
  await SQLite.importDatabaseFromAssetAsync(filename, { assetId });
  return SQLite.openDatabaseAsync(filename);
}

let strongsDb: SQLite.SQLiteDatabase | null = null;
let strongsDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
export async function getStrongsDb(): Promise<SQLite.SQLiteDatabase> {
  if (strongsDb) return strongsDb;
  if (!strongsDbPromise) {
    strongsDbPromise = openBundled('strongs_v1.db', require('@/assets/strongs_v1.db')).then((db) => {
      strongsDb = db;
      return db;
    });
  }
  return strongsDbPromise;
}

let crossrefsDb: SQLite.SQLiteDatabase | null = null;
let crossrefsDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
export async function getCrossrefsDb(): Promise<SQLite.SQLiteDatabase> {
  if (crossrefsDb) return crossrefsDb;
  if (!crossrefsDbPromise) {
    crossrefsDbPromise = openBundled('crossrefs_v1.db', require('@/assets/crossrefs_v1.db')).then((db) => {
      crossrefsDb = db;
      return db;
    });
  }
  return crossrefsDbPromise;
}

let commentaryDb: SQLite.SQLiteDatabase | null = null;
let commentaryDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
export async function getCommentaryDb(): Promise<SQLite.SQLiteDatabase> {
  if (commentaryDb) return commentaryDb;
  if (!commentaryDbPromise) {
    commentaryDbPromise = openBundled('commentary_mhc_v1.db', require('@/assets/commentary_mhc_v1.db')).then((db) => {
      commentaryDb = db;
      return db;
    });
  }
  return commentaryDbPromise;
}

// ---------------------------------------------------------------------------
// Patristic commentary — optional download, never bundled (77MB; the app is
// shared over Bluetooth/Telegram in the field and has to stay small).
// ---------------------------------------------------------------------------

export const PATRISTIC_DB_FILENAME = 'commentary_patristic_v1.db';

/**
 * Exact byte size of the source asset. Hardcoded rather than fetched with a
 * HEAD request — there's no manifest for this file (unlike the APK's
 * latest.json) and the app needs to show a size before the user commits to
 * downloading, offline-safely. Update this if the file is ever rebuilt.
 */
export const PATRISTIC_DB_SIZE_BYTES = 80_429_056;

/**
 * NOT YET HOSTED. This file must be uploaded to this exact path on the
 * server before download will work — see the delivery report for this
 * feature. Follows the same birhan.online/downloads/ convention as the APK.
 */
export const PATRISTIC_DB_URL = 'https://birhan.online/downloads/commentary_patristic_v1.db';

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Where the downloaded database lives, as a `file://` URI.
 *
 * Every caller of this is an expo-file-system call, and that API addresses
 * files by URI. `SQLite.defaultDatabaseDirectory` is a bare path (on Android,
 * `context.filesDir + "/SQLite"`), so handing it over unconverted made
 * getInfoAsync report the file as absent — which surfaced as "not downloaded"
 * however many times it had been. SQLite itself opens by filename, not by this
 * path, so it is unaffected either way.
 */
function patristicDbPath(): string {
  return toFileUri(joinPath(SQLite.defaultDatabaseDirectory, PATRISTIC_DB_FILENAME));
}

export async function isPatristicDbDownloaded(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(patristicDbPath());
    return info.exists;
  } catch {
    return false;
  }
}

let patristicDb: SQLite.SQLiteDatabase | null = null;

/** Returns null if the database hasn't been downloaded yet — never throws. */
export async function getPatristicDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (patristicDb) return patristicDb;
  if (!(await isPatristicDbDownloaded())) return null;
  patristicDb = await SQLite.openDatabaseAsync(PATRISTIC_DB_FILENAME);
  return patristicDb;
}

let activePatristicDownload: FileSystem.DownloadResumable | null = null;

export async function downloadPatristicDb(
  onProgress?: (percent: number) => void,
): Promise<void> {
  const dir = toFileUri(SQLite.defaultDatabaseDirectory);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = patristicDbPath();

  activePatristicDownload = FileSystem.createDownloadResumable(
    PATRISTIC_DB_URL,
    dest,
    {},
    (progress) => {
      if (progress.totalBytesExpectedToWrite > 0 && onProgress) {
        onProgress(Math.floor((progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100));
      }
    },
  );

  try {
    const result = await activePatristicDownload.downloadAsync();
    activePatristicDownload = null;
    if (!result || !result.uri) {
      throw new Error('Patristic database download failed: empty result.');
    }

    // 77MB over a real connection in the field is exactly the kind of
    // download that gets truncated. Confirm it actually opens and holds the
    // expected tables before trusting it — a half-written SQLite file opens
    // "successfully" but errors on first query.
    const check = await SQLite.openDatabaseAsync(PATRISTIC_DB_FILENAME);
    try {
      const row = await check.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM authors');
      if (!row || row.n < 1) {
        throw new Error('Downloaded patristic database is missing expected data.');
      }
    } finally {
      await check.closeAsync();
    }

    patristicDb = null; // force a fresh open picking up the new file
  } catch (err) {
    activePatristicDownload = null;
    patristicDb = null;
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    throw err;
  }
}

export async function cancelPatristicDownload(): Promise<void> {
  if (activePatristicDownload) {
    try {
      await activePatristicDownload.cancelAsync();
    } catch {
      // ignore
    } finally {
      activePatristicDownload = null;
    }
  }
}

export async function deletePatristicDb(): Promise<void> {
  await FileSystem.deleteAsync(patristicDbPath(), { idempotent: true }).catch(() => {});
  patristicDb = null;
}
