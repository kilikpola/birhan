import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client.
 *
 * OFFLINE SESSION — the reason the app's thesis survives "login required":
 * the session token is persisted to AsyncStorage and read from DISK on every
 * launch. No network call to know who you are. So the Bible opens offline
 * forever after the first sign-in; only writes need connectivity.
 *
 *   persistSession: true      → token written to AsyncStorage
 *   autoRefreshToken: true    → refreshed when online; harmless offline
 *   detectSessionInUrl: false → RN has no URL to parse
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Fail loud in dev, not silently at the first query.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. See supabase/00_SETUP.md',
  );
}

export const supabase = createClient(url, anon, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
