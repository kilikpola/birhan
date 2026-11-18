import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  FlatList,
  Modal,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useNetInfo } from '@react-native-community/netinfo';
import { useApp } from '@/theme/context';
import { t } from '@/i18n';
import { space, radius, fonts, TARGET } from '@/theme/tokens';
import { Icon } from '@/components/icon';
import { formatBytes } from '@/lib/format';
import {
  initAudioDirectory,
  initAudioDatabase,
  downloadChapter,
  deleteBook,
  getAllDownloadedAudio,
  getDownloadSize,
  getTotalStorageUsed,
  clearAllAudio,
  setWifiOnly,
  getWifiOnly,
  DownloadProgress,
} from '@/lib/audioDownload';
import { BOOK_CHAPTER_COUNTS } from '../../assets/audioManifest';
import { reportError } from '@/lib/errors';
import { useToast } from '@/components/toast';
import { SectionBoundary } from '@/components/section-boundary';

interface Book {
  id: number;
  name_am: string;
  name_en: string;
  testament: string;
  chapters: number;
}

export default function AudioScreen() {
  const { c, lang } = useApp();
  const db = useSQLiteContext();
  const { showToast } = useToast();
  const netInfo = useNetInfo();
  const isWifi = netInfo.type === 'wifi';
  const isAm = lang === 'am';

  const [books, setBooks] = useState<Book[]>([]);
  const [downloaded, setDownloaded] = useState<Map<string, boolean>>(new Map());
  const [downloading, setDownloading] = useState<Map<string, DownloadProgress>>(new Map());
  const [storageUsed, setStorageUsed] = useState(0);
  const [wifiOnly, setWifiOnlyState] = useState(true);
  const [activeTestament, setActiveTestament] = useState<'OT' | 'NT'>('OT');
  const [expandedBookId, setExpandedBookId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalBook, setModalBook] = useState<Book | null>(null);
  const [modalChapter, setModalChapter] = useState<number | 0>(0);
  const [modalSize, setModalSize] = useState(0);

  const numeral = (n: number) => (isAm ? toGeezNumeral(n) : String(n));
  const bookName = (b: Book) => (isAm ? b.name_am : b.name_en);
  const downloadKey = (bookId: number, chapter: number) => `${bookId}-${chapter}`;

  useEffect(() => {
    async function init() {
      await initAudioDatabase();
      await initAudioDirectory();
      
      const booksList = await db.getAllAsync<Book>("SELECT * FROM books ORDER BY id ASC");
      setBooks(booksList);
      
      const audioFiles = await getAllDownloadedAudio();
      const downloadedMap = new Map<string, boolean>();
      audioFiles.forEach(f => downloadedMap.set(downloadKey(f.bookId, f.chapter), true));
      setDownloaded(downloadedMap);
      
      const totalStorage = await getTotalStorageUsed();
      setStorageUsed(totalStorage);
      
      const wifiOnlySetting = await getWifiOnly();
      setWifiOnlyState(wifiOnlySetting);
      
      setLoading(false);
    }
    init();
  }, [db]);

  const handleDownload = useCallback(async (bookId: number, chapter: number) => {
    const key = downloadKey(bookId, chapter);
    if (downloading.has(key) || downloaded.has(key)) return;

    const book = books.find(b => b.id === bookId);
    if (!book) return;

    if (wifiOnly && !isWifi) {
      Alert.alert(
        t(lang, 'wifiRequiredTitle'),
        t(lang, 'wifiRequiredMessage'),
        [{ text: t(lang, 'ok') }]
      );
      return;
    }

    setDownloading(prev => new Map(prev).set(key, {
      filename: '',
      totalBytes: 0,
      downloadedBytes: 0,
      progress: 0,
      status: 'downloading',
    }));

    try {
      await downloadChapter(bookId, chapter, (progress) => {
        setDownloading(prev => new Map(prev).set(key, progress));
      });
      
      setDownloading(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setDownloaded(prev => new Map(prev).set(key, true));
      
      const totalStorage = await getTotalStorageUsed();
      setStorageUsed(totalStorage);
      
      showToast(t(lang, 'downloadComplete'), 'success');
    } catch (err) {
      setDownloading(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      reportError(err instanceof Error ? err : new Error('Download failed'), 'AudioScreen.download');
      showToast(t(lang, 'downloadFailed'), 'error');
    }
  }, [books, downloading, downloaded, wifiOnly, isWifi, lang, showToast]);

  const handleDeleteBook = useCallback(async (bookId: number) => {
    const count = await deleteBook(bookId);
    setDownloaded(prev => {
      const next = new Map(prev);
      for (let ch = 1; ch <= (BOOK_CHAPTER_COUNTS[bookId] || 150); ch++) {
        next.delete(downloadKey(bookId, ch));
      }
      return next;
    });
    const totalStorage = await getTotalStorageUsed();
    setStorageUsed(totalStorage);
    showToast(`${count} ${t(lang, 'chaptersDeleted')}`, 'success');
  }, [lang, showToast]);

  const handleClearAll = useCallback(async () => {
    Alert.alert(
      t(lang, 'clearAllTitle'),
      t(lang, 'clearAllMessage'),
      [
        { text: t(lang, 'cancel'), style: 'cancel' },
        { text: t(lang, 'delete'), style: 'destructive', onPress: async () => {
          await clearAllAudio();
          setDownloaded(new Map());
          setStorageUsed(0);
          showToast(t(lang, 'allCleared'), 'success');
        }},
      ]
    );
  }, [lang, showToast]);

  const showDownloadConfirm = (book: Book, chapter: number) => {
    setModalBook(book);
    setModalChapter(chapter);
    getDownloadSize(book.id, chapter).then(size => setModalSize(size));
    setModalVisible(true);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <Text style={[styles.loadingText, { color: c.text }]}>{t(lang, 'preparingLibrary')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const testamentBooks = books.filter(b => b.testament === activeTestament);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <SectionBoundary name="Audio.Storage">
          <View style={[styles.storageCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.storageHeader}>
              <View style={styles.storageIcon}>
                <Icon name="storage" size={24} color={c.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.storageTitle, { color: c.text }]}>{t(lang, 'audioStorage')}</Text>
                <Text style={[styles.storageSubtitle, { color: c.textSoft }]}>{t(lang, 'audioStorageNote')}</Text>
              </View>
              <View style={styles.storageSize}>
                <Text style={[styles.storageSizeText, { color: c.text }]}>{formatBytes(storageUsed)}</Text>
                <Text style={[styles.storageSizeLabel, { color: c.textSoft }]}>{t(lang, 'used')}</Text>
              </View>
            </View>
            <View style={styles.storageActions}>
              <Pressable
                onPress={() => setWifiOnly(!wifiOnly)}
                style={[styles.actionBtn, { backgroundColor: wifiOnly ? c.accentGlow : c.surface, borderColor: wifiOnly ? c.accent : c.border }]}
              >
                <Icon name={isWifi ? 'wifi' : 'wifiOff'} size={18} color={wifiOnly ? c.accent : c.textSoft} />
                <Text style={[styles.actionBtnText, { color: wifiOnly ? c.accent : c.text }]}>{t(lang, 'wifiOnly')}</Text>
              </Pressable>
              <Pressable
                onPress={handleClearAll}
                style={[styles.actionBtn, { backgroundColor: c.dangerGlow || 'rgba(210,86,75,0.1)', borderColor: c.danger || '#E5675B' }]}
              >
                <Icon name="trash" size={18} color={c.danger || '#E5675B'} />
                <Text style={[styles.actionBtnText, { color: c.danger || '#E5675B' }]}>{t(lang, 'clearAll')}</Text>
              </Pressable>
            </View>
          </View>
        </SectionBoundary>

        <SectionBoundary name="Audio.TestamentPicker">
          <View style={styles.testamentPicker}>
            <Pressable
              onPress={() => setActiveTestament('OT')}
              style={[styles.testamentBtn, activeTestament === 'OT' && { backgroundColor: c.accent, borderColor: c.accent }]}
            >
              <Text style={[styles.testamentBtnText, { color: activeTestament === 'OT' ? c.onAccent : c.text }]}>{t(lang, 'oldTestament')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTestament('NT')}
              style={[styles.testamentBtn, activeTestament === 'NT' && { backgroundColor: c.accent, borderColor: c.accent }]}
            >
              <Text style={[styles.testamentBtnText, { color: activeTestament === 'NT' ? c.onAccent : c.text }]}>{t(lang, 'newTestament')}</Text>
            </Pressable>
          </View>
        </SectionBoundary>

        <FlatList
          data={testamentBooks}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={styles.bookList}
          renderItem={({ item }) => {
            const isExpanded = expandedBookId === item.id;
            const chapters = BOOK_CHAPTER_COUNTS[item.id] || item.chapters;
            const downloadedCount = Array.from({ length: chapters }, (_, i) => i + 1)
              .filter(ch => downloaded.has(downloadKey(item.id, ch))).length;
            const downloadingCount = Array.from({ length: chapters }, (_, i) => i + 1)
              .filter(ch => downloading.has(downloadKey(item.id, ch))).length;

            return (
              <View style={[styles.bookItem, { borderBottomColor: c.border }]}>
                <Pressable
                  onPress={() => setExpandedBookId(isExpanded ? null : item.id)}
                  style={styles.bookItemHeader}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                >
                  <View style={styles.bookInfo}>
                    <Text style={[styles.bookName, { color: c.text }]}>{bookName(item)}</Text>
                    <View style={styles.bookMeta}>
                      <Text style={[styles.bookMetaText, { color: c.textSoft }]}>
                        {downloadedCount}/{chapters} {t(lang, 'chapters')}
                      </Text>
                      {downloadingCount > 0 && (
                        <Text style={[styles.bookMetaText, { color: c.accent }]}>
                          {downloadingCount} {t(lang, 'downloading')}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.bookActions}>
                    {downloadedCount > 0 && (
                      <Pressable
                        onPress={() => handleDeleteBook(item.id)}
                        style={styles.actionIconBtn}
                        accessibilityLabel={t(lang, 'deleteBook')}
                      >
                        <Icon name="trash" size={20} color={c.danger || '#E5675B'} />
                      </Pressable>
                    )}
                    <Icon name={isExpanded ? 'chevDown' : 'chev'} size={20} color={c.textSoft} />
                  </View>
                </Pressable>

                {isExpanded && (
                  <View style={styles.chaptersList}>
                    {Array.from({ length: chapters }, (_, i) => i + 1).map(ch => {
                      const key = downloadKey(item.id, ch);
                      const isDownloaded = downloaded.has(key);
                      const isDownloading = downloading.has(key);
                      const progress = downloading.get(key);
                      
                      return (
                        <Pressable
                          key={ch}
                          onPress={() => isDownloaded ? showDownloadConfirm(item, ch) : handleDownload(item.id, ch)}
                          style={[
                            styles.chapterRow,
                            { borderBottomColor: c.border },
                            isDownloading && { backgroundColor: c.accentGlow },
                          ]}
                        >
                          <View style={styles.chapterLeft}>
                            <Text style={[styles.chapterNum, { color: c.text }]}>{numeral(ch)}</Text>
                            <View style={styles.chapterStatus}>
                              {isDownloading && progress && (
                                <View style={styles.progressMini}>
                                  <Animated.View
                                    style={[
                                      styles.progressMiniBar,
                                      { backgroundColor: c.accent },
                                      { width: `${progress.progress * 100}%` },
                                    ]}
                                  />
                                </View>
                              )}
                              {isDownloaded && !isDownloading && (
                                <Icon name="check" size={16} color={c.success || '#6FB383'} />
                              )}
                              {!isDownloaded && !isDownloading && (
                                <Icon name="download" size={16} color={c.textFaint} />
                              )}
                            </View>
                          </View>
                          {isDownloaded && (
                            <Pressable
                              onPress={(e) => { e.stopPropagation(); showDownloadConfirm(item, ch); }}
                              style={styles.deleteBtn}
                              accessibilityLabel={t(lang, 'deleteChapter')}
                            >
                              <Icon name="trash" size={18} color={c.danger || '#E5675B'} />
                            </Pressable>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          }}
        />
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setModalVisible(false)} />
        <View style={[styles.modal, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>{t(lang, 'downloadChapter')}</Text>
            <Pressable onPress={() => setModalVisible(false)} style={styles.textBtn}>
              <Text style={[styles.textBtnTxt, { color: c.accent }]}>{t(lang, 'close')}</Text>
            </Pressable>
          </View>
          <View style={styles.modalContent}>
            {modalBook && (
              <View style={styles.modalInfo}>
                <Text style={[styles.modalBook, { color: c.text }]}>{bookName(modalBook)} {numeral(modalChapter)}</Text>
                <Text style={[styles.modalSize, { color: c.textSoft }]}>{formatBytes(modalSize)} {t(lang, 'willDownload')}</Text>
              </View>
            )}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setModalVisible(false)} style={[styles.modalBtn, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.modalBtnText, { color: c.text }]}>{t(lang, 'cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (modalBook) {
                    handleDownload(modalBook.id, modalChapter);
                    setModalVisible(false);
                  }
                }}
                style={[styles.modalBtn, { backgroundColor: c.accent }]}
              >
                <Text style={[styles.modalBtnText, { color: c.onAccent }]}>{t(lang, 'download')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function toGeezNumeral(n: number): string {
  const geezDigits = ['፩', '፪', '፫', '፬', '፭', '፮', '፯', '፰', '፱', '፲'];
  return String(n).split('').map(d => geezDigits[parseInt(d)] || d).join('');
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingBottom: 100 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  loadingText: { fontSize: 16, marginTop: space.md },
  storageCard: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, marginHorizontal: space.lg, marginTop: space.lg, overflow: 'hidden' },
  storageHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  storageIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: '#E3A93C20', alignItems: 'center', justifyContent: 'center' },
  storageTitle: { fontSize: 17, fontWeight: '700' },
  storageSubtitle: { fontSize: 13, marginTop: 2 },
  storageSize: { alignItems: 'flex-end' },
  storageSizeText: { fontSize: 24, fontWeight: '700', fontFamily: fonts.am },
  storageSizeLabel: { fontSize: 13, marginTop: 2 },
  storageActions: { flexDirection: 'row', gap: space.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
  testamentPicker: { flexDirection: 'row', paddingHorizontal: space.lg, marginTop: space.md },
  testamentBtn: { flex: 1, paddingVertical: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  testamentBtnText: { fontSize: 15, fontWeight: '600' },
  bookList: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  bookItem: { borderBottomWidth: StyleSheet.hairlineWidth },
  bookItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.md },
  bookInfo: { flex: 1 },
  bookName: { fontSize: 17, fontWeight: '600' },
  bookMeta: { flexDirection: 'row', gap: space.md, marginTop: 2 },
  bookMetaText: { fontSize: 13 },
  bookActions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actionIconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  chaptersList: { marginTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#00000020' },
  chapterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.sm, paddingHorizontal: space.md, minHeight: 48 },
  chapterLeft: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chapterNum: { fontSize: 16, fontWeight: '600', width: 40 },
  chapterStatus: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  progressMini: { width: 20, height: 3, borderRadius: 2, backgroundColor: '#00000020', overflow: 'hidden' },
  progressMiniBar: { height: '100%', borderRadius: 2 },
  deleteBtn: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  modal: { margin: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  textBtn: { minHeight: TARGET, minWidth: TARGET, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  textBtnTxt: { fontSize: 16, fontWeight: '600' },
  modalContent: { padding: space.lg },
  modalInfo: { alignItems: 'center', marginBottom: space.lg },
  modalBook: { fontSize: 20, fontWeight: '700', marginBottom: space.sm },
  modalSize: { fontSize: 15 },
  modalActions: { flexDirection: 'row', gap: space.md },
  modalBtn: { flex: 1, paddingVertical: space.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  modalBtnText: { fontSize: 16, fontWeight: '600' },
});