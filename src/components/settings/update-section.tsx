import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Icon } from '@/components/icon';
import { radius, space, fonts } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';
import { reportError } from '@/lib/errors';
import {
  checkForApkUpdate,
  downloadAndVerifyApk,
  cancelApkDownload,
  launchApkInstaller,
  getLastCheckTime,
  getCurrentVersionName,
  getCurrentVersionCode,
  type ApkCheckResult,
  type ApkUpdateInfo,
} from '@/lib/apkUpdates';
import {
  getAllowMobileData,
  setAllowMobileData,
  isNetworkAllowedForDownload,
} from '@/lib/otaUpdates';

/**
 * Updates, in Settings.
 *
 * The thing this screen exists to fix: there was previously no way for anyone
 * to make the app look for an update. The check ran on one tab's mount, at most
 * once a day, and reported every outcome — throttled, offline, 404, malformed,
 * genuinely current — as the same silent nothing. So a published release could
 * sit there indefinitely with nobody being offered it and no way to ask.
 *
 * Hence: a button that ignores the throttle, the time of the last real check
 * shown next to it, and failures stated as failures. "You're up to date" is
 * only ever shown when the server actually answered.
 */

/** "Just now" / "5 min ago" / "3 h ago" / "2 d ago". */
function formatLastChecked(ts: number | null, lang: Lang): string {
  if (ts === null) return t(lang, 'lastCheckedNever');
  const elapsed = Date.now() - ts;
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return t(lang, 'timeJustNow');
  if (minutes < 60) return t(lang, 'timeMinutesAgo').replace('%1', String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(lang, 'timeHoursAgo').replace('%1', String(hours));
  return t(lang, 'timeDaysAgo').replace('%1', String(Math.floor(hours / 24)));
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

export function UpdateSection({ c, lang }: { c: Palette; lang: Lang }) {
  const isAm = lang === 'am';

  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ApkCheckResult | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [allowMobile, setAllowMobile] = useState(false);

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [readyFileUri, setReadyFileUri] = useState<string | null>(null);

  useEffect(() => {
    getLastCheckTime().then(setLastChecked);
    getAllowMobileData().then(setAllowMobile);

    // The unattended check: still throttled, still fire-and-forget, and its
    // result is only rendered if it is an actual answer. Nothing awaits it.
    checkForApkUpdate().then(async (res) => {
      if (res.status === 'update-available') setResult(res);
      // It may have just written a new timestamp, and the read above raced it.
      if (res.status !== 'throttled') setLastChecked(await getLastCheckTime());
    });
  }, []);

  /** The button. Ignores the 24-hour throttle — that is the whole point. */
  const runCheck = useCallback(async () => {
    setChecking(true);
    setResult(null);
    const res = await checkForApkUpdate({ force: true });
    setResult(res);
    setLastChecked(await getLastCheckTime());
    setChecking(false);
  }, []);

  const startDownload = async (info: ApkUpdateInfo) => {
    setDownloading(true);
    setProgress(0);
    setVerifying(false);
    try {
      const res = await downloadAndVerifyApk(
        info.manifest,
        (p) => setProgress(p),
        () => setVerifying(true)
      );
      setReadyFileUri(res.fileUri);
      setDownloading(false);
      setVerifying(false);
      Alert.alert(t(lang, 'otaUpdateReady'), t(lang, 'installPermissionGuide'), [
        { text: t(lang, 'btnInstallApk'), onPress: () => launchApkInstaller(res.fileUri) },
      ]);
    } catch (err: any) {
      setDownloading(false);
      setVerifying(false);
      setProgress(0);
      reportError(err, 'Settings.downloadApk', lang, false);
      const isHashFailure = String(err?.message || '').includes('SHA-256');
      Alert.alert(
        isAm ? 'ስህተት' : 'Error',
        isHashFailure ? t(lang, 'errHashMismatch') : t(lang, 'errGeneric')
      );
    }
  };

  const onDownloadPress = async (info: ApkUpdateInfo) => {
    if (readyFileUri) {
      launchApkInstaller(readyFileUri);
      return;
    }

    // Wi-Fi is the default; mobile data needs saying yes to, with the cost shown.
    const allowed = await isNetworkAllowedForDownload();
    if (!allowed) {
      Alert.alert(
        isAm ? 'ማሳሰቢያ' : 'Notice',
        t(lang, 'mobileDataWarning').replace('%1', mb(info.manifest.sizeBytes)),
        [
          { text: t(lang, 'deleteCancel'), style: 'cancel' },
          {
            // Consent for this download, not a permanent change to their
            // preference — agreeing once should not quietly turn the setting on.
            text: isAm ? 'ቀጥል' : 'Continue',
            onPress: () => startDownload(info),
          },
        ]
      );
      return;
    }
    startDownload(info);
  };

  const toggleMobile = async () => {
    const next = !allowMobile;
    setAllowMobile(next);
    await setAllowMobileData(next);
  };

  const available = result?.status === 'update-available' ? result.info : null;

  return (
    <View style={{ gap: space.sm }}>
      {/* Installed version */}
      <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.label, { color: c.text }, isAm && styles.am]}>
          {t(lang, 'installedVersion')}
        </Text>
        <Text style={[styles.value, { color: c.textFaint }]}>
          {getCurrentVersionName()} ({getCurrentVersionCode()})
        </Text>
      </View>

      {/* Check for updates */}
      <Pressable
        onPress={runCheck}
        disabled={checking}
        accessibilityRole="button"
        style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: c.text }, isAm && styles.am]}>
            {checking ? t(lang, 'btnChecking') : t(lang, 'checkForUpdates')}
          </Text>
          <Text style={[styles.sub, { color: c.textFaint }, isAm && styles.amSub]}>
            {t(lang, 'lastChecked')}: {formatLastChecked(lastChecked, lang)}
          </Text>
        </View>
        {checking ? <ActivityIndicator color={c.accent} /> : <Icon name="chev" size={15} color={c.textFaint} />}
      </Pressable>

      {/* The result — an answer, a failure, or nothing yet. Never a failure
          dressed up as "up to date". */}
      {result?.status === 'up-to-date' && (
        <View style={[styles.note, { borderColor: c.border, backgroundColor: c.surface }]}>
          <Icon name="check" size={15} color={c.success} />
          <Text style={[styles.noteTxt, { color: c.textSoft }, isAm && styles.amSub]}>
            {t(lang, 'updateUpToDate')}
          </Text>
        </View>
      )}

      {result?.status === 'failed' && (
        <View style={[styles.note, { borderColor: c.danger, backgroundColor: c.surface }]}>
          <Icon name="alert" size={15} color={c.danger} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.noteTxt, { color: c.danger }, isAm && styles.amSub]}>
              {t(lang, 'updateCheckFailed')}
            </Text>
            <Text style={[styles.sub, { color: c.textFaint }, isAm && styles.amSub]}>
              {t(lang, 'updateCheckFailedNote')}
            </Text>
          </View>
        </View>
      )}

      {available && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.accent }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="down" size={15} color={c.accent} />
            <Text style={[styles.cardTitle, { color: c.accent }, isAm && styles.am]}>
              {available.isMandatory ? t(lang, 'updateRequired') : t(lang, 'updateAvailable')}
            </Text>
          </View>

          <Text style={[styles.sub, { color: c.text }]}>
            {t(lang, 'updateVersion')}: {available.manifest.versionName} (
            {available.manifest.versionCode}) • {mb(available.manifest.sizeBytes)} MB
          </Text>

          <Text style={[styles.sub, { color: c.textFaint }, isAm && styles.amSub]}>
            {isAm ? available.manifest.notes_am : available.manifest.notes_en}
          </Text>

          {downloading ? (
            <View style={{ gap: space.sm }}>
              <Text style={[styles.sub, { color: c.accent }, isAm && styles.amSub]}>
                {verifying
                  ? t(lang, 'verifyingDownload')
                  : t(lang, 'btnDownloading').replace('%1', String(progress))}
              </Text>
              <View style={{ height: 6, backgroundColor: c.border, borderRadius: 3, overflow: 'hidden' }}>
                <View style={{ width: `${progress}%`, height: '100%', backgroundColor: c.accent }} />
              </View>
              <Pressable
                onPress={async () => {
                  await cancelApkDownload();
                  setDownloading(false);
                  setVerifying(false);
                  setProgress(0);
                }}
                style={styles.cancel}
              >
                <Text style={[styles.sub, { color: c.danger }]}>{t(lang, 'btnCancelDownload')}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => onDownloadPress(available)}
              accessibilityRole="button"
              style={[styles.cta, { backgroundColor: c.accent }]}
            >
              <Text style={[styles.ctaTxt, { color: c.bg }]}>
                {readyFileUri ? t(lang, 'btnInstallApk') : t(lang, 'btnDownloadUpdate')}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Wi-Fi only is the default. */}
      <Pressable
        onPress={toggleMobile}
        accessibilityRole="switch"
        accessibilityState={{ checked: allowMobile }}
        style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
      >
        <Text style={[styles.label, { color: c.text, flex: 1 }, isAm && styles.am]}>
          {t(lang, 'allowMobileDataUpdates')}
        </Text>
        <View
          style={[
            styles.chip,
            {
              borderColor: allowMobile ? c.accentDim : c.border,
              backgroundColor: allowMobile ? c.accentGlow : 'transparent',
            },
          ]}
        >
          <Text style={{ color: allowMobile ? c.accent : c.textFaint, fontSize: 11, fontWeight: '700' }}>
            {allowMobile ? 'ON' : 'OFF'}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // 52 clears the 48dp minimum touch target.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  label: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  value: { fontSize: 13 },
  sub: { fontSize: 12.5, lineHeight: 18 },
  // Ge'ez needs the taller line box — ~1.9x, per the project's own rule.
  am: { fontFamily: fonts.amBold, lineHeight: 27 },
  amSub: { fontFamily: fonts.am, lineHeight: 24 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  noteTxt: { flex: 1, fontSize: 13, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cta: { minHeight: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { fontSize: 14.5, fontWeight: '700' },
  cancel: { minHeight: 48, justifyContent: 'center' },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
