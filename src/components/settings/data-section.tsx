import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import { radius, space, fonts } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';
import { Row, ToggleRow } from './rows';
import { reportError } from '@/lib/errors';
import { getStorageBreakdown, clearCachedData, formatBytes, type StorageBreakdown } from '@/lib/storage';
import {
  PATRISTIC_DB_SIZE_BYTES,
  formatMB,
  isPatristicDbDownloaded,
  downloadPatristicDb,
  cancelPatristicDownload,
  deletePatristicDb,
} from '@/lib/verseStudyDb';
import { getAllowMobileData, setAllowMobileData, isNetworkAllowedForDownload } from '@/lib/otaUpdates';

/**
 * Data & downloads.
 *
 * The storage figures are split rather than given as one number because the
 * three parts mean different things to someone deciding what to remove: the
 * library is why the app works offline and is not removable here, documents
 * are removed one at a time on the screen that owns them, and only the third
 * is genuinely disposable.
 */
export function DataSection({ c, lang }: { c: Palette; lang: Lang }) {
  const isAm = lang === 'am';

  const [storage, setStorage] = useState<StorageBreakdown | null>(null);
  const [hasPatristic, setHasPatristic] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [wifiOnly, setWifiOnly] = useState(true);

  const refresh = useCallback(async () => {
    const [breakdown, present, allowMobile] = await Promise.all([
      getStorageBreakdown(),
      isPatristicDbDownloaded(),
      getAllowMobileData(),
    ]);
    setStorage(breakdown);
    setHasPatristic(present);
    setWifiOnly(!allowMobile);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startPatristic = async () => {
    // Same rule as the APK: Wi-Fi unless the size has been shown and accepted.
    const allowed = await isNetworkAllowedForDownload();
    if (!allowed) {
      Alert.alert(
        isAm ? 'ማሳሰቢያ' : 'Notice',
        t(lang, 'mobileDataWarning').replace(
          '%1',
          (PATRISTIC_DB_SIZE_BYTES / (1024 * 1024)).toFixed(1),
        ),
        [
          { text: t(lang, 'deleteCancel'), style: 'cancel' },
          { text: isAm ? 'ቀጥል' : 'Continue', onPress: runPatristicDownload },
        ],
      );
      return;
    }
    runPatristicDownload();
  };

  const runPatristicDownload = async () => {
    setDownloading(true);
    setProgress(0);
    try {
      await downloadPatristicDb(setProgress);
      setHasPatristic(true);
      await refresh();
    } catch (err) {
      reportError(err, 'Settings.downloadPatristic', lang, false);
      Alert.alert(isAm ? 'ስህተት' : 'Error', t(lang, 'fathersDownloadFailed'));
    } finally {
      setDownloading(false);
      setProgress(0);
    }
  };

  const removePatristic = () => {
    Alert.alert(
      t(lang, 'patristicTitle'),
      t(lang, 'fathersDeletePrompt').replace('%1', formatMB(PATRISTIC_DB_SIZE_BYTES)),
      [
        { text: t(lang, 'deleteCancel'), style: 'cancel' },
        {
          text: t(lang, 'delete'),
          style: 'destructive',
          onPress: async () => {
            await deletePatristicDb();
            setHasPatristic(false);
            await refresh();
          },
        },
      ],
    );
  };

  const clearCache = () => {
    Alert.alert(t(lang, 'clearCache'), t(lang, 'clearCacheConfirm'), [
      { text: t(lang, 'deleteCancel'), style: 'cancel' },
      {
        text: t(lang, 'clearCache'),
        onPress: async () => {
          const freed = await clearCachedData();
          await refresh();
          Alert.alert(
            t(lang, 'clearCache'),
            freed > 0
              ? t(lang, 'clearCacheDone').replace('%1', formatBytes(freed))
              : t(lang, 'clearCacheNothing'),
          );
        },
      },
    ]);
  };

  const toggleWifiOnly = async () => {
    const next = !wifiOnly;
    setWifiOnly(next);
    // The stored preference is the inverse: "allow mobile data".
    await setAllowMobileData(!next);
  };

  return (
    <View style={{ gap: space.sm }}>
      <Row
        c={c}
        lang={lang}
        label={t(lang, 'totalStorageUsed')}
        value={storage ? formatBytes(storage.totalBytes) : '…'}
      />
      <Row
        c={c}
        lang={lang}
        label={t(lang, 'storageLibrary')}
        note={t(lang, 'storageLibraryNote')}
        value={storage ? formatBytes(storage.libraryBytes) : '…'}
      />
      <Row
        c={c}
        lang={lang}
        label={t(lang, 'storageResources')}
        value={storage ? formatBytes(storage.resourcesBytes) : '…'}
      />
      <Row
        c={c}
        lang={lang}
        label={t(lang, 'storageCache')}
        value={storage ? formatBytes(storage.cacheBytes) : '…'}
      />

      <Pressable onPress={clearCache} accessibilityRole="button">
        <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.action, { color: c.accent }, isAm && styles.actionAm]}>
            {t(lang, 'clearCache')}
          </Text>
        </View>
      </Pressable>

      {/* The optional commentary download. */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.title, { color: c.text }, isAm && styles.actionAm]}>
          {t(lang, 'patristicTitle')}
        </Text>

        {downloading ? (
          <View style={{ gap: space.sm }}>
            <Text style={[styles.note, { color: c.accent }]}>
              {t(lang, 'fathersDownloadingProgress').replace('%1', String(progress))}
            </Text>
            <View style={{ height: 6, backgroundColor: c.border, borderRadius: 3, overflow: 'hidden' }}>
              <View style={{ width: `${progress}%`, height: '100%', backgroundColor: c.accent }} />
            </View>
            <Pressable
              onPress={async () => {
                await cancelPatristicDownload();
                setDownloading(false);
                setProgress(0);
              }}
              style={styles.tap}
            >
              <Text style={[styles.note, { color: c.danger }]}>{t(lang, 'btnCancelDownload')}</Text>
            </Pressable>
          </View>
        ) : hasPatristic ? (
          <>
            <Text style={[styles.note, { color: c.textFaint }, isAm && styles.noteAm]}>
              {formatMB(PATRISTIC_DB_SIZE_BYTES)}
            </Text>
            <Pressable onPress={removePatristic} style={styles.tap} accessibilityRole="button">
              <Text style={[styles.action, { color: c.danger }, isAm && styles.actionAm]}>
                {t(lang, 'delete')}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.note, { color: c.textFaint }, isAm && styles.noteAm]}>
              {t(lang, 'fathersNotDownloaded')}
            </Text>
            <Pressable
              onPress={startPatristic}
              style={[styles.cta, { backgroundColor: c.accent }]}
              accessibilityRole="button"
            >
              <Text style={[styles.ctaTxt, { color: c.bg }]}>
                {t(lang, 'btnDownloadFathers').replace('%1', formatMB(PATRISTIC_DB_SIZE_BYTES))}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <ToggleRow
        c={c}
        lang={lang}
        label={isAm ? 'በWiFi ብቻ አውርድ' : 'Download over Wi-Fi only'}
        value={wifiOnly}
        onToggle={toggleWifiOnly}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  title: { fontSize: 14.5, fontWeight: '700' },
  action: { fontSize: 14.5, fontWeight: '600' },
  actionAm: { fontFamily: fonts.amBold, lineHeight: 27 },
  note: { fontSize: 12.5, lineHeight: 18 },
  noteAm: { fontFamily: fonts.am, lineHeight: 24 },
  tap: { minHeight: 48, justifyContent: 'center' },
  cta: { minHeight: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { fontSize: 14.5, fontWeight: '700' },
});
