import { useCallback, useEffect, useState } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/icon';
import { t, type Lang } from '@/i18n';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { reportError } from '@/lib/errors';
import { isNetworkAllowedForDownload } from '@/lib/downloadPolicy';
import {
  PATRISTIC_DB_SIZE_BYTES,
  formatMB,
  downloadPatristicDb,
  cancelPatristicDownload,
} from '@/lib/verseStudyDb';
import { getCommentary, getPatristicEntries, type CommentaryEntry, type FatherEntry } from '@/lib/verseStudy';
import { CollapsibleSection } from './collapsible-section';
import type { StudyVerseRef } from './types';

function groupByAuthor(entries: FatherEntry[]) {
  const map = new Map<number, { authorId: number; authorName: string; authorYear: number | null; entries: FatherEntry[] }>();
  for (const e of entries) {
    const existing = map.get(e.authorId);
    if (existing) {
      existing.entries.push(e);
    } else {
      map.set(e.authorId, { authorId: e.authorId, authorName: e.authorName, authorYear: e.authorYear, entries: [e] });
    }
  }
  return Array.from(map.values());
}

export function CommentaryModal({
  visible,
  verseRef,
  lang,
  colors,
  onClose,
}: {
  visible: boolean;
  verseRef: StudyVerseRef | null;
  lang: Lang;
  colors: Palette;
  onClose: () => void;
}) {
  const isAm = lang === 'am';
  const [loading, setLoading] = useState(true);
  const [mhc, setMhc] = useState<CommentaryEntry[]>([]);
  /** null = patristic db not downloaded yet; [] = downloaded, nothing for this verse. */
  const [fathers, setFathers] = useState<FatherEntry[] | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!verseRef) return;
    setLoading(true);
    try {
      const [mhcRows, fathersRows] = await Promise.all([
        getCommentary(verseRef.book, verseRef.chapter, verseRef.verse),
        getPatristicEntries(verseRef.book, verseRef.chapter, verseRef.verse),
      ]);
      setMhc(mhcRows);
      setFathers(fathersRows);
    } catch (err) {
      reportError(err, 'CommentaryModal.load', lang, false);
      setMhc([]);
      setFathers(null);
    } finally {
      setLoading(false);
    }
  }, [verseRef, lang]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  useEffect(() => {
    if (!visible) {
      cancelPatristicDownload();
      setTimeout(() => {
        setDownloading(false);
        setProgress(0);
        setDownloadNotice(null);
      }, 0);
    }
  }, [visible]);

  const handleDownload = async () => {
    setDownloadNotice(null);
    const allowed = await isNetworkAllowedForDownload();
    if (!allowed) {
      setDownloadNotice(t(lang, 'fathersWifiOnlyNotice'));
      return;
    }
    setDownloading(true);
    setProgress(0);
    try {
      await downloadPatristicDb((pct) => setProgress(pct));
      await load();
    } catch (err) {
      reportError(err, 'CommentaryModal.download', lang, false);
      setDownloadNotice(t(lang, 'fathersDownloadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  const fathersGroups = fathers ? groupByAuthor(fathers) : [];
  const isEmpty = !loading && mhc.length === 0 && fathers !== null && fathers.length === 0;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={[styles.outer, { backgroundColor: colors.bg }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <View style={{ transform: [{ rotate: '180deg' }] }}>
              <Icon name="chev" size={18} color={colors.textSoft} />
            </View>
          </TouchableOpacity>
          <ThemedText type="subtitle" colorType="text">{t(lang, 'commentaryTitle')}</ThemedText>
          <View style={{ width: 18 }} />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : isEmpty ? (
          <ThemedText type="default" colorType="textFaint" style={styles.empty}>
            {t(lang, 'commentaryEmpty')}
          </ThemedText>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <CollapsibleSection
              title={t(lang, 'commentarySourceMhc')}
              count={mhc.length}
              defaultOpen
              colors={colors}
            >
              {mhc.length === 0 ? (
                <ThemedText type="small" colorType="textFaint">{t(lang, 'commentaryEmpty')}</ThemedText>
              ) : (
                mhc.map((entry) => (
                  <View key={entry.id} style={styles.entry}>
                    <ThemedText type="smallBold" colorType="accent" style={{ marginBottom: 4 }}>
                      {entry.label}
                    </ThemedText>
                    <ThemedText type="small" colorType="text" style={styles.body}>
                      {entry.body}
                    </ThemedText>
                  </View>
                ))
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title={t(lang, 'commentarySourceFathers')}
              count={fathers ? fathers.length : undefined}
              defaultOpen={false}
              colors={colors}
            >
              {fathers === null ? (
                <View>
                  <ThemedText type="small" colorType="textSoft" style={{ marginBottom: space.sm }}>
                    {t(lang, 'fathersDownloadPrompt').replace('%1', formatMB(PATRISTIC_DB_SIZE_BYTES))}
                  </ThemedText>
                  {downloading ? (
                    <View style={{ gap: space.sm }}>
                      <ActivityIndicator color={colors.accent} />
                      <ThemedText type="small" colorType="textFaint" style={{ textAlign: 'center' }}>
                        {t(lang, 'fathersDownloadingProgress').replace('%1', String(progress))}
                      </ThemedText>
                      <TouchableOpacity
                        onPress={() => {
                          cancelPatristicDownload();
                          setDownloading(false);
                        }}
                        style={[styles.cancelBtn, { borderColor: colors.border }]}
                      >
                        <ThemedText type="small" colorType="textSoft">{t(lang, 'btnCancelDownload')}</ThemedText>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={handleDownload}
                      style={[styles.downloadBtn, { backgroundColor: colors.accent }]}
                    >
                      <ThemedText type="smallBold" style={{ color: colors.bg }}>
                        {t(lang, 'btnDownloadFathers').replace('%1', formatMB(PATRISTIC_DB_SIZE_BYTES))}
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                  {!!downloadNotice && (
                    <ThemedText type="small" colorType="danger" style={{ marginTop: space.sm }}>
                      {downloadNotice}
                    </ThemedText>
                  )}
                </View>
              ) : fathersGroups.length === 0 ? (
                <ThemedText type="small" colorType="textFaint">{t(lang, 'commentaryFathersEmpty')}</ThemedText>
              ) : (
                fathersGroups.map((group) => (
                  <View key={group.authorId} style={styles.entry}>
                    <ThemedText type="smallBold" colorType="text" style={{ marginBottom: 4 }}>
                      {group.authorName}{group.authorYear ? ` (†${group.authorYear})` : ''}
                    </ThemedText>
                    {group.entries.map((e) => (
                      <ThemedText key={e.id} type="small" colorType="textSoft" style={[styles.body, { marginBottom: space.sm }]}>
                        {e.body}
                      </ThemedText>
                    ))}
                  </View>
                ))
              )}
            </CollapsibleSection>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  list: { padding: space.lg, paddingBottom: 40 },
  entry: { marginBottom: space.md },
  body: { lineHeight: 20 },
  downloadBtn: {
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtn: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
});
