import * as FileSystem from 'expo-file-system';
import { getAudioUrl, getPatchAudioUrl, parseAudioFilename } from '@/assets/audioManifest';
import { getLocalDb, runTransactionExclusive } from '@/utils/db';
import { reportError } from '@/lib/errors';

export interface DownloadProgress {
  filename: string;
  totalBytes: number;
  downloadedBytes: number;
  progress: number;
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'failed';
  error?: string;
}

export interface AudioDownloadInfo {
  bookId: number;
  chapter: number;
  filename: string;
  size: number;
  localPath: string;
  downloadedAt: number;
  downloaded: boolean;
}

const AUDIO_DIR = `${FileSystem.documentDirectory}audio/`;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

let wifiOnly = true;
let activeDownloads = new Map<string, { resumeData: string; cancelled: boolean }>();

export async function initAudioDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
  }
}

export async function setWifiOnly(value: boolean): Promise<void> {
  wifiOnly = value;
  const localDb = await getLocalDb();
  await localDb.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['audio_wifi_only', value ? '1' : '0']);
}

export async function getWifiOnly(): Promise<boolean> {
  const localDb = await getLocalDb();
  const row = await localDb.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['audio_wifi_only']);
  return row?.value === '1';
}

export async function getDownloadSize(bookId: number, chapter: number): Promise<number> {
  try {
    const url = getAudioUrl(bookId, chapter);
    const response = await fetch(url, { method: 'HEAD' });
    const contentLength = response.headers.get('content-length');
    if (contentLength) return parseInt(contentLength, 10);
    const patchUrl = getPatchAudioUrl(bookId, chapter);
    const patchResponse = await fetch(patchUrl, { method: 'HEAD' });
    const patchLength = patchResponse.headers.get('content-length');
    return patchLength ? parseInt(patchLength, 10) : 0;
  } catch {
    return 0;
  }
}

export async function isChapterDownloaded(bookId: number, chapter: number): Promise<boolean> {
  const localDb = await getLocalDb();
  const row = await localDb.getFirstAsync<{ filename: string }>(
    'SELECT filename FROM audio_downloads WHERE book_id = ? AND chapter = ?',
    [bookId, chapter]
  );
  if (!row) return false;
  const info = await FileSystem.getInfoAsync(row.filename);
  return info.exists;
}

export async function getDownloadedChapters(bookId: number): Promise<number[]> {
  const localDb = await getLocalDb();
  const rows = await localDb.getAllAsync<{ chapter: number }>(
    'SELECT chapter FROM audio_downloads WHERE book_id = ? ORDER BY chapter',
    [bookId]
  );
  return rows.map(r => r.chapter);
}

export async function getAllDownloadedAudio(): Promise<AudioDownloadInfo[]> {
  const localDb = await getLocalDb();
  const rows = await localDb.getAllAsync<{
    book_id: number;
    chapter: number;
    filename: string;
    size: number;
    downloaded_at: number;
  }>('SELECT * FROM audio_downloads ORDER BY book_id, chapter');
  
  const results: AudioDownloadInfo[] = [];
  for (const row of rows) {
    const info = await FileSystem.getInfoAsync(row.filename);
    results.push({
      bookId: row.book_id,
      chapter: row.chapter,
      filename: row.filename.split('/').pop() || '',
      size: row.size,
      localPath: row.filename,
      downloadedAt: row.downloaded_at,
      downloaded: info.exists,
    });
  }
  return results;
}

export async function downloadChapter(
  bookId: number,
  chapter: number,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  await initAudioDirectory();
  
  const filename = `${getBookAbbrev(bookId)}_${String(chapter).padStart(3, '0')}.mp3`;
  const localPath = `${AUDIO_DIR}${filename}`;
  
  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists && existing.size > 0) {
    await recordDownload(bookId, chapter, filename, localPath, existing.size);
    return localPath;
  }

  const urls = [getAudioUrl(bookId, chapter), getPatchAudioUrl(bookId, chapter)];
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      
      const downloadKey = `${bookId}-${chapter}`;
      activeDownloads.set(downloadKey, { resumeData: '', cancelled: false });

      const callback = (downloadProgress: FileSystem.DownloadProgressData) => {
        const entry = activeDownloads.get(downloadKey);
        if (entry?.cancelled) {
          controller.abort();
          return;
        }
        if (onProgress && downloadProgress.totalBytesWritten > 0) {
          onProgress({
            filename,
            totalBytes: downloadProgress.totalBytesExpectedToWrite,
            downloadedBytes: downloadProgress.totalBytesWritten,
            progress: downloadProgress.totalBytesExpectedToWrite > 0
              ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
              : 0,
            status: 'downloading',
          });
        }
      };

      await FileSystem.downloadAsync(url, localPath, {
        md5: false,
        headers: { 'Accept': 'audio/mpeg' },
      });

      clearTimeout(timeoutId);
      activeDownloads.delete(downloadKey);

      const info = await FileSystem.getInfoAsync(localPath);
      if (info.exists && info.size > 0) {
        await recordDownload(bookId, chapter, filename, localPath, info.size);
        onProgress?.({
          filename,
          totalBytes: info.size,
          downloadedBytes: info.size,
          progress: 1,
          status: 'completed',
        });
        return localPath;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
  }

  activeDownloads.delete(`${bookId}-${chapter}`);
  await FileSystem.deleteAsync(localPath, { idempotent: true });
  throw lastError || new Error('Download failed');
}

export function cancelDownload(bookId: number, chapter: number): void {
  const key = `${bookId}-${chapter}`;
  const entry = activeDownloads.get(key);
  if (entry) {
    entry.cancelled = true;
  }
}

export async function deleteChapter(bookId: number, chapter: number): Promise<void> {
  const localDb = await getLocalDb();
  const row = await localDb.getFirstAsync<{ filename: string }>(
    'SELECT filename FROM audio_downloads WHERE book_id = ? AND chapter = ?',
    [bookId, chapter]
  );
  if (row) {
    await FileSystem.deleteAsync(row.filename, { idempotent: true });
    await localDb.runAsync('DELETE FROM audio_downloads WHERE book_id = ? AND chapter = ?', [bookId, chapter]);
  }
}

export async function deleteBook(bookId: number): Promise<number> {
  const localDb = await getLocalDb();
  const rows = await localDb.getAllAsync<{ filename: string }>(
    'SELECT filename FROM audio_downloads WHERE book_id = ?',
    [bookId]
  );
  for (const row of rows) {
    await FileSystem.deleteAsync(row.filename, { idempotent: true });
  }
  const result = await localDb.runAsync('DELETE FROM audio_downloads WHERE book_id = ?', [bookId]);
  return result.changes;
}

export async function getTotalStorageUsed(): Promise<number> {
  const localDb = await getLocalDb();
  const row = await localDb.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(size), 0) as total FROM audio_downloads'
  );
  return row?.total || 0;
}

export async function clearAllAudio(): Promise<number> {
  const info = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (info.exists) {
    await FileSystem.deleteAsync(AUDIO_DIR, { idempotent: true });
    await initAudioDirectory();
  }
  const localDb = await getLocalDb();
  const result = await localDb.runAsync('DELETE FROM audio_downloads');
  return result.changes;
}

async function recordDownload(
  bookId: number,
  chapter: number,
  filename: string,
  localPath: string,
  size: number
): Promise<void> {
  const localDb = await getLocalDb();
  await runTransactionExclusive(localDb, async (txn) => {
    await txn.runAsync(
      'INSERT OR REPLACE INTO audio_downloads (book_id, chapter, filename, size, downloaded_at) VALUES (?, ?, ?, ?, ?)',
      [bookId, chapter, localPath, size, Date.now()]
    );
  });
}

function getBookAbbrev(bookId: number): string {
  const entry = Object.entries(BOOK_ABBREV_TO_ID).find(([, id]) => id === bookId);
  return entry?.[0] || 'GEN';
}

const BOOK_ABBREV_TO_ID: Record<string, number> = {
  GEN: 1, EXO: 2, LEV: 3, NUM: 4, DEU: 5, JOS: 6, JDG: 7, RUT: 8,
  '1SA': 9, '2SA': 10, '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14,
  EZR: 15, NEH: 16, EST: 17, JOB: 18, PSA: 19, PRO: 20, ECC: 21, SNG: 22,
  ISA: 23, JER: 24, LAM: 25, EZK: 26, DAN: 27, HOS: 28, JOL: 29, AMO: 30,
  OBA: 31, JON: 32, MIC: 33, NAM: 34, HAB: 35, ZEP: 36, HAG: 37, ZEC: 38, MAL: 39,
  MAT: 40, MRK: 41, LUK: 42, JHN: 43, ACT: 44, ROM: 45, '1CO': 46, '2CO': 47,
  GAL: 48, EPH: 49, PHP: 50, COL: 51, '1TH': 52, '2TH': 53, '1TI': 54, '2TI': 55,
  TIT: 56, PHM: 57, HEB: 58, JAS: 59, '1PE': 60, '2PE': 61, '1JN': 62, '2JN': 63,
  '3JN': 64, JUD: 65, REV: 66,
};

export async function initAudioDatabase(): Promise<void> {
  const localDb = await getLocalDb();
  await localDb.execAsync(`
    CREATE TABLE IF NOT EXISTS audio_downloads (
      book_id INTEGER NOT NULL,
      chapter INTEGER NOT NULL,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      downloaded_at INTEGER NOT NULL,
      PRIMARY KEY (book_id, chapter)
    );
    
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  
  try {
    await localDb.runAsync('ALTER TABLE audio_downloads ADD COLUMN downloaded_at INTEGER');
  } catch {}
}