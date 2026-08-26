import { useState, useEffect, useCallback } from 'react';
import { Platform, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory, cacheDirectory } from 'expo-file-system/legacy';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
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
 */
export async function fetchResourcesList(churchId: string): Promise<Resource[]> {
  const cacheKey = `${KEY_RESOURCES_CACHE}${churchId}`;

  try {
    const { data, error } = await supabase
      .from('resources')
      .select('*')
      .eq('church_id', churchId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    if (data) {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(data));
      return data as Resource[];
    }
  } catch (err: any) {
    // Fallback to offline cache
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as Resource[];
      } catch (parseErr) {
        // Fall through
      }
    }
    // If table doesn't exist yet on remote database (PGRST205 schema cache), return empty array
    if (err?.code === 'PGRST205' || String(err?.message || '').includes('public.resources')) {
      return [];
    }
    throw err;
  }

  return [];
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

  // Get signed URL or download URL from Supabase Storage
  const { data, error } = await supabase.storage
    .from('church-docs')
    .createSignedUrl(resource.file_path, 3600);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Could not get download URL for document');
  }

  const downloadTask = FileSystem.createDownloadResumable(
    data.signedUrl,
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
 * Uploads a document to church-docs bucket and inserts resource metadata in DB.
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

  try {
    const resourceId = window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    const sanitizeName = payload.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${payload.churchId}/${resourceId}/${sanitizeName}`;

    // Read binary file data into ArrayBuffer/Blob for Supabase storage upload
    const fileResponse = await fetch(payload.fileUri);
    const blob = await fileResponse.blob();

    const { error: uploadError } = await supabase.storage
      .from('church-docs')
      .upload(storagePath, blob, {
        contentType: payload.mimeType,
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: dbData, error: dbError } = await supabase
      .from('resources')
      .insert({
        id: resourceId,
        church_id: payload.churchId,
        branch_id: payload.branchId || null,
        uploaded_by: payload.uploadedBy,
        title_am: payload.titleAm || null,
        title_en: payload.titleEn || null,
        description: payload.description || null,
        category: payload.category,
        file_path: storagePath,
        file_size_bytes: payload.fileSize,
        mime_type: payload.mimeType,
        rights_confirmed: true,
      })
      .select('*')
      .single();

    if (dbError) {
      // Clean up uploaded file if DB insert fails
      await supabase.storage.from('church-docs').remove([storagePath]);
      throw dbError;
    }

    return { data: dbData as Resource };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Deletes a resource from storage and database.
 */
export async function deleteResource(resource: Resource): Promise<{ error?: string }> {
  try {
    const { error: storageError } = await supabase.storage
      .from('church-docs')
      .remove([resource.file_path]);

    if (storageError) {
      console.warn('Storage deletion notice:', storageError.message);
    }

    const { error: dbError } = await supabase
      .from('resources')
      .delete()
      .eq('id', resource.id);

    if (dbError) throw dbError;

    // Delete local cached copy if exists
    const filename = resource.file_path.split('/').pop() || 'document.pdf';
    const localUri = getLocalResourcePath(resource.id, filename);
    await FileSystem.deleteAsync(localUri, { idempotent: true });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Calculates total storage used by church in bytes.
 */
export async function getChurchStorageUsed(churchId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('resources')
      .select('file_size_bytes')
      .eq('church_id', churchId);

    if (error || !data) return 0;
    return data.reduce((sum, item) => sum + (Number(item.file_size_bytes) || 0), 0);
  } catch {
    return 0;
  }
}
