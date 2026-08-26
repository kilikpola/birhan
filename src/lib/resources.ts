import { useState, useEffect, useCallback } from 'react';
import { Platform, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory, cacheDirectory } from 'expo-file-system/legacy';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { apiFetch, ApiError } from './api';
import { reportError } from './errors';

export type ResourceCategory =
  | 'sermon_notes'
  | 'study_guide'
  | 'calendar'
  | 'announcement_doc'
  | 'other';

export type Resource = {
  id: string;
  church_id: string;
  branch_id: string | null;
  uploaded_by: string;
  title_am: string | null;
  title_en: string | null;
  description: string | null;
  category: ResourceCategory;
  file_path: string;
  file_size_bytes: number;
  mime_type: string;
  rights_confirmed: boolean;
  created_at: string;
};

export type UploadResourcePayload = {
  churchId: string;
  uploadedBy: string;
  branchId?: string | null;
  titleAm?: string;
  titleEn?: string;
  description?: string;
  category: ResourceCategory;
  rightsConfirmed: boolean;
  fileUri: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

/** GET /api/v1/resources returns camelCase — flattened to match every
 * existing call site's snake_case reads (resources.tsx, admin.tsx). */
function normalizeResource(raw: any): Resource {
  return {
    id: raw.id,
    church_id: raw.churchId,
    branch_id: raw.branchId ?? null,
    uploaded_by: raw.uploadedBy,
    title_am: raw.titleAm ?? null,
    title_en: raw.titleEn ?? null,
    description: raw.description ?? null,
    category: raw.category,
    file_path: raw.filePath,
    file_size_bytes: raw.fileSizeBytes,
    mime_type: raw.mimeType,
    rights_confirmed: raw.rightsConfirmed,
    created_at: raw.createdAt,
  };
}

const KEY_RESOURCES_CACHE = 'birhan:resources_cache:';
const KEY_BYTES_USED = 'birhan:bytesThisMonth';

const getDir = () => {
  const doc = documentDirectory || cacheDirectory || '';
  return doc.endsWith('/') ? `${doc}resources/` : `${doc}/resources/`;
};

export async function ensureResourceDir() {
  try {
    const dir = getDir();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  } catch (err) {
    // Graceful fallback
  }
}

export function getLocalResourcePath(id: string, filename: string): string {
  // Sanitize filename for local storage
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${getDir()}${id}_${safeFilename}`;
}

async function recordDataUsage(bytes: number) {
  try {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const raw = await AsyncStorage.getItem(KEY_BYTES_USED);
    const parsed = raw ? JSON.parse(raw) : { month: thisMonth, bytes: 0 };
    const currentBytes = parsed.month === thisMonth ? parsed.bytes : 0;
    await AsyncStorage.setItem(
      KEY_BYTES_USED,
      JSON.stringify({ month: thisMonth, bytes: currentBytes + bytes })
    );
  } catch (e) {
    // Non-fatal
  }
}

/**
 * Fetches resources list for a church, falling back to local cache if offline.
 * `churchId` is only used for the local cache key now — GET /api/v1/resources
 * is always scoped server-side to the caller's own church (from the JWT), the
 * same as every other backend route.
 */
export async function fetchResourcesList(churchId: string): Promise<Resource[]> {
  const cacheKey = `${KEY_RESOURCES_CACHE}${churchId}`;

  try {
    // 100 is the backend's own cap (services/resources.ts: `Math.min(limit,
    // 100)`) — the old Supabase query asked for up to 200, so a church with
    // more than 100 resources will now see fewer than before.
    const res = await apiFetch<{ resources: any[] }>('/api/v1/resources?limit=100');
    const mapped = res.resources.map(normalizeResource);
    await AsyncStorage.setItem(cacheKey, JSON.stringify(mapped));
    return mapped;
  } catch (err) {
    // Fallback to offline cache
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as Resource[];
      } catch {
        // Fall through
      }
    }
    if (err instanceof ApiError) return [];
    throw err;
  }
}

/**
 * Custom hook to manage resource list and offline state.
 */
export function useResources(churchId: string | null | undefined) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setOnline(Boolean(s.isConnected && s.isInternetReachable !== false));
    });
    return () => unsub();
  }, []);

  const load = useCallback(async () => {
    if (!churchId) {
      setResources([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchResourcesList(churchId);
      setResources(data);
    } catch (err) {
      reportError(err, 'useResources.load', 'am', false);
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    load();
  }, [load]);

  return { resources, loading, online, reload: load };
}

/**
 * Check if a resource file is already downloaded locally.
 */
export async function checkLocalResource(id: string, filename: string): Promise<boolean> {
  try {
    await ensureResourceDir();
    const path = getLocalResourcePath(id, filename);
    const info = await FileSystem.getInfoAsync(path);
    return info.exists;
  } catch {
    return false;
  }
}

/**
 * Downloads a resource file to local disk.
 */
export async function downloadResource(
  resource: Resource,
  onProgress?: (progress: number) => void
): Promise<string> {
  await ensureResourceDir();
  const filename = resource.file_path.split('/').pop() || 'document.pdf';
  const localUri = getLocalResourcePath(resource.id, filename);

  // Check if already present
  const info = await FileSystem.getInfoAsync(localUri);
  if (info.exists) {
    return localUri;
  }

  // Presigned S3 GET URL, valid briefly — replaces Supabase's signed URL.
  const { url } = await apiFetch<{ url: string }>(`/api/v1/resources/${resource.id}/download-url`);

  const downloadTask = FileSystem.createDownloadResumable(
    url,
    localUri,
    {},
    (downloadProgress) => {
      const pct = downloadProgress.totalBytesExpectedToWrite
        ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
        : 0;
      if (onProgress) onProgress(pct);
    }
  );

  const res = await downloadTask.downloadAsync();
  if (!res || !res.uri) {
    throw new Error('Download failed');
  }

  await recordDataUsage(resource.file_size_bytes);
  return res.uri;
}

/**
 * Opens a resource file with the system viewer.
 */
export async function openResource(resource: Resource): Promise<void> {
  const filename = resource.file_path.split('/').pop() || 'document.pdf';
  let localUri = getLocalResourcePath(resource.id, filename);

  const info = await FileSystem.getInfoAsync(localUri);
  if (!info.exists) {
    localUri = await downloadResource(resource);
  }

  if (Platform.OS === 'android') {
    const contentUri = await FileSystem.getContentUriAsync(localUri);
    try {
      await Linking.openURL(contentUri);
    } catch {
      await WebBrowser.openBrowserAsync(contentUri);
    }
  } else {
    try {
      await WebBrowser.openBrowserAsync(localUri);
    } catch {
      await Linking.openURL(localUri);
    }
  }
}

/**
 * Uploads a document via a presigned S3 URL, then commits its metadata.
 * Explicitly enforces rights_confirmed attestation.
 */
export async function uploadResource(payload: UploadResourcePayload): Promise<{ data?: Resource; error?: string }> {
  if (!payload.rightsConfirmed) {
    return { error: 'Licensing rights confirmation is required before uploading.' };
  }

  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB cap
  if (payload.fileSize > MAX_FILE_SIZE_BYTES) {
    return { error: 'File size exceeds the 10 MB limit.' };
  }

  // The upload UI (admin.tsx) only requires ONE of the two titles to be
  // filled in — but the backend's commit schema requires both non-empty.
  // Falling the empty one back to the other, same as announcements' title_am
  // /title_en duplication, rather than changing the upload form's validation.
  const titleAm = payload.titleAm?.trim() || payload.titleEn?.trim() || 'Untitled';
  const titleEn = payload.titleEn?.trim() || payload.titleAm?.trim() || 'Untitled';

  try {
    const { resourceId, url, key } = await apiFetch<{ resourceId: string; url: string; key: string }>(
      '/api/v1/resources/upload-url',
      {
        method: 'POST',
        body: { filename: payload.fileName, mimeType: payload.mimeType, fileSizeBytes: payload.fileSize },
      },
    );

    const fileResponse = await fetch(payload.fileUri);
    const blob = await fileResponse.blob();

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': payload.mimeType },
      body: blob,
    });
    if (!putRes.ok) {
      throw new Error(`Upload to storage failed with status ${putRes.status}`);
    }

    const raw = await apiFetch<any>('/api/v1/resources', {
      method: 'POST',
      body: {
        resourceId,
        key,
        titleAm,
        titleEn,
        description: payload.description,
        category: payload.category,
        fileSizeBytes: payload.fileSize,
        mimeType: payload.mimeType,
        rightsConfirmed: payload.rightsConfirmed,
      },
    });

    return { data: normalizeResource(raw) };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Deletes a resource from storage and database.
 */
export async function deleteResource(resource: Resource): Promise<{ error?: string }> {
  try {
    await apiFetch(`/api/v1/resources/${resource.id}`, { method: 'DELETE' });

    // Delete local cached copy if exists
    const filename = resource.file_path.split('/').pop() || 'document.pdf';
    const localUri = getLocalResourcePath(resource.id, filename);
    await FileSystem.deleteAsync(localUri, { idempotent: true });

    return {};
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Calculates total storage used by the caller's church in bytes.
 *
 * Approximate: there's no dedicated storage-usage endpoint, so this sums
 * fileSizeBytes off the same capped (max 100) resource list used elsewhere.
 * A church with more than 100 resources will undercount.
 */
export async function getChurchStorageUsed(churchId: string): Promise<number> {
  try {
    const list = await fetchResourcesList(churchId);
    return list.reduce((sum, item) => sum + (Number(item.file_size_bytes) || 0), 0);
  } catch {
    return 0;
  }
}
