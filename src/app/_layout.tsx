import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { useNavigationContainerRef } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { initMonitoring, navigationIntegration } from '../lib/monitoring';
import {
  useFonts,
  NotoSerifEthiopic_400Regular,
  NotoSerifEthiopic_700Bold,
} from '@expo-google-fonts/noto-serif-ethiopic';

import { light, dark } from '../theme/tokens';
import { Ctx } from '../theme/context';
import type { Lang } from '../i18n';
import AppTabs from '../components/app-tabs';
import { AuthProvider, useAuth } from '../lib/auth';
import { usePushNotifications } from '../lib/push';
import Auth from './auth';

// Initialise Sentry as early as possible so errors during startup are caught.
// No-op without EXPO_PUBLIC_SENTRY_DSN (dev / Expo Go / tests).
initMonitoring();

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate({ children }: { children: React.ReactNode }) {
  const { session, ready } = useAuth();
  // Register for push once signed in (no-op offline / without a token).
  usePushNotifications(session?.user?.id);
  if (!ready) return null;          // reading session from disk — instant, offline
  if (!session) return <Auth />;    // first run: show login
  return <>{children}</>;           // signed in: the app
}

import { ErrorBoundary } from '../components/error-boundary';
import { ToastProvider } from '../components/toast';

const PREF_NIGHT = 'birhan:night';
const PREF_LANG = 'birhan:lang';

function RootLayout() {
  const [night, setNightState] = useState(true);
  const [lang, setLangState] = useState<Lang>('am');
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Register expo-router's navigation container so Sentry can name routes and
  // measure screen transitions. Harmless when monitoring is disabled.
  const navRef = useNavigationContainerRef();
  useEffect(() => {
    if (navRef?.current) navigationIntegration.registerNavigationContainer(navRef);
  }, [navRef]);

  const [loaded, error] = useFonts({
    NotoSerifEthiopic_400Regular,
    NotoSerifEthiopic_700Bold,
  });

  // Restore the user's theme + language from disk on launch (offline-safe).
  useEffect(() => {
    (async () => {
      try {
        const [n, l] = await Promise.all([
          AsyncStorage.getItem(PREF_NIGHT),
          AsyncStorage.getItem(PREF_LANG),
        ]);
        if (n !== null) setNightState(n === '1');
        if (l === 'am' || l === 'en') setLangState(l);
      } catch {
        // Non-fatal — fall back to defaults.
      } finally {
        setPrefsLoaded(true);
      }
    })();
  }, []);

  const setNight = useCallback((v: boolean) => {
    setNightState(v);
    AsyncStorage.setItem(PREF_NIGHT, v ? '1' : '0').catch(() => {});
  }, []);

  const setLang = useCallback((v: Lang) => {
    setLangState(v);
    AsyncStorage.setItem(PREF_LANG, v).catch(() => {});
  }, []);

  useEffect(() => {
    if ((loaded || error) && prefsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error, prefsLoaded]);

  if ((!loaded && !error) || !prefsLoaded) return null;

  const c = night ? dark : light;

  return (
    <ErrorBoundary>
      <AuthProvider>
        <Ctx.Provider value={{ c, night, setNight, lang, setLang }}>
          <ToastProvider>
            <SQLiteProvider
              databaseName="bible_v3.db"
              assetSource={{ assetId: require('@/assets/bible_v3.db') }}
            >
              <Gate>
                <AppTabs />
              </Gate>
            </SQLiteProvider>
          </ToastProvider>
        </Ctx.Provider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

// Sentry.wrap enables error boundary + performance tracing at the app root.
export default Sentry.wrap(RootLayout);

