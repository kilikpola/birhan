import { Suspense, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
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

import { light, dark, type Palette } from '../theme/tokens';
import { Ctx, useApp } from '../theme/context';
import { t, type Lang } from '../i18n';
import AppTabs from '../components/app-tabs';
import { AuthProvider, useAuth } from '../lib/auth';
import { usePushNotifications } from '../lib/push';
import { EmailVerificationScreen } from '../components/auth/email-verification-screen';
import Auth from './auth';
import { ErrorBoundary } from '../components/error-boundary';
import { ToastProvider } from '../components/toast';

// Initialise Sentry as early as possible so errors during startup are caught.
// No-op without EXPO_PUBLIC_SENTRY_DSN (dev / Expo Go / tests).
initMonitoring();

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Anything that has to wait for I/O renders THIS, never `null`.
 *
 * Rendering `null` at the root paints the window's own background, which on
 * Android is plain black — indistinguishable from a crashed app. That is
 * exactly what 1.0.4 shipped: the splash was hidden as soon as the fonts and
 * prefs were ready, while the tree below still had a 24MB database to import,
 * and `SQLiteProvider` renders `null` for the whole of that wait.
 */
function Booting({ c, label, note }: { c: Palette; label?: string; note?: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <ActivityIndicator size="large" color={c.accent} />
      {label ? (
        <Text
          style={{ color: c.text, fontSize: 15, marginTop: 18, textAlign: 'center' }}
        >
          {label}
        </Text>
      ) : null}
      {note ? (
        <Text
          style={{
            color: c.textSoft,
            fontSize: 13,
            marginTop: 6,
            textAlign: 'center',
            lineHeight: 20,
          }}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** The Bible database, mounted only for the screens that actually read it. */
function BibleLibrary({ children }: { children: React.ReactNode }) {
  const { c, lang } = useApp();
  return (
    <Suspense
      fallback={
        <Booting
          c={c}
          label={t(lang, 'preparingLibrary')}
          note={t(lang, 'preparingLibraryNote')}
        />
      }
    >
      <SQLiteProvider
        databaseName="bible_v3.db"
        assetSource={{ assetId: require('@/assets/bible_v3.db') }}
        useSuspense
      >
        {children}
      </SQLiteProvider>
    </Suspense>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { session, ready, pendingEmailVerification, dismissEmailVerificationPrompt } = useAuth();
  const { c, lang } = useApp();
  // Register for push once signed in (no-op offline / without a token).
  usePushNotifications(session?.user?.id);
  if (!ready) return <Booting c={c} />;  // reading session from disk — instant, offline
  if (!session) return <Auth />;         // first run: show login
  // Shown once, right after a signup that included an email. Dismissable —
  // an unverified account can read and use everything else, so this never
  // blocks re-entry to the app on a later launch (see auth.tsx's
  // pendingEmailVerification doc comment for why it isn't persisted).
  if (pendingEmailVerification) {
    return (
      <EmailVerificationScreen
        c={c}
        lang={lang}
        email={pendingEmailVerification.email}
        verificationSent={pendingEmailVerification.verificationSent}
        onDone={dismissEmailVerificationPrompt}
      />
    );
  }
  // Signed in: the app — and only now is the Bible database worth waiting for.
  return <BibleLibrary>{children}</BibleLibrary>;
}

const PREF_NIGHT = 'birhan:night';
const PREF_LANG = 'birhan:lang';

/** Fonts are bundled, so they load in milliseconds — but never hold the app
 *  hostage to them. After this long, fall back to system fonts and continue. */
const FONT_TIMEOUT_MS = 5000;

function RootLayout() {
  const [night, setNightState] = useState(true);
  const [lang, setLangState] = useState<Lang>('am');
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [fontTimeout, setFontTimeout] = useState(false);

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

  useEffect(() => {
    if (loaded || error) return;
    const timer = setTimeout(() => setFontTimeout(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded, error]);

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

  const fontsSettled = loaded || !!error || fontTimeout;
  const c = night ? dark : light;

  // Hand off from the native splash only once this tree paints something of
  // its own. Everything below Booting is themed, so there is no black frame
  // between the splash going away and the first screen appearing.
  useEffect(() => {
    if (fontsSettled && prefsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsSettled, prefsLoaded]);

  if (!fontsSettled || !prefsLoaded) return <Booting c={c} />;

  return (
    <ErrorBoundary>
      <AuthProvider>
        <Ctx.Provider value={{ c, night, setNight, lang, setLang }}>
          <ToastProvider>
            <Gate>
              <AppTabs />
            </Gate>
          </ToastProvider>
        </Ctx.Provider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

// Sentry.wrap enables error boundary + performance tracing at the app root.
export default Sentry.wrap(RootLayout);
