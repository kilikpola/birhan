import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useRouter, useFocusEffect } from 'expo-router';

import * as Clipboard from 'expo-clipboard';

import { useApp } from '../theme/context';
import { t } from '../i18n';
import { fonts, radius, space, TARGET } from '../theme/tokens';
import { toEthiopian, formatEthiopian, toGeezNumeral } from '../lib/ethiopian';
import { getLocalDb } from '../utils/db';
import { useToast } from '../components/toast';
import { getVerseOfDay, VerseOfDay } from '../lib/verseOfDay';
import { syncDailyVerseNotifications } from '../lib/dailyVerse';
import { searchBible, VerseResult } from '../utils/search';
import { Icon } from '../components/icon';
import { reportError } from '../lib/errors';
import { TodaySkeleton } from '../components/skeletons/today-skeleton';
import { useSkeleton } from '../lib/use-skeleton';
import { SectionBoundary } from '../components/section-boundary';

export default function Today() {
  const { c, lang } = useApp();
  const bibleDb = useSQLiteContext();
  const router = useRouter();

  const { showToast } = useToast();
  const [vod, setVod] = useState<VerseOfDay | null>(null);
  const [vodSettled, setVodSettled] = useState(false);
  const [lastRead, setLastRead] = useState<{
    book: number;
    name_am: string;
    name_en: string;
    chapters: number;
    chapter: number;
  } | null>(null);

  // Search Modal
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VerseResult[]>([]);

  const am = lang === 'am';

  // Amharic screens render their numbers in Ge'ez, never mixed with Latin digits.
  const num = (n: number) => (am ? toGeezNumeral(n) : String(n));

  // Compute Ethiopian Date
  const ethDate = useMemo(() => formatEthiopian(toEthiopian(new Date()), lang), [lang]);

  // Load Verse of the Day
  useEffect(() => {
    let active = true;
    getVerseOfDay(bibleDb)
      .then((v) => { if (active) setVod(v); })
      .catch((err) => reportError(err, 'Today.getVerseOfDay', lang, false))
      // Mark settled even on failure so the skeleton clears instead of spinning
      // forever when the verse fails to load.
      .finally(() => { if (active) setVodSettled(true); });
    return () => { active = false; };
  }, [bibleDb, lang]);

  // Keep the daily-verse reminders scheduled ahead. The Today screen is the
  // natural place: it opens on app launch and already holds the Bible db, so
  // every launch rolls the window forward with the correct verse per day.
  // Entirely local — a no-op in Expo Go or if the user turned it off.
  useEffect(() => {
    syncDailyVerseNotifications(bibleDb, lang);
  }, [bibleDb, lang]);

  // Load the real "continue reading" position saved by the Bible screen —
  // on every focus, because the Bible tab moves it while this tab stays mounted.
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const localDb = await getLocalDb();
        const pos = await localDb.getFirstAsync<{ book: number; chapter: number }>(
          'SELECT book, chapter FROM reading_position ORDER BY updated_at DESC LIMIT 1',
        );
        if (!pos) return;
        const bk = await bibleDb.getFirstAsync<{ name_am: string; name_en: string; chapters: number }>(
          'SELECT name_am, name_en, chapters FROM books WHERE id = ?',
          [pos.book],
        );
        if (bk) setLastRead({ ...bk, book: pos.book, chapter: pos.chapter });
      } catch (err) {
        reportError(err, 'Today.loadReadingPosition', lang, false);
      }
    })();
  }, [bibleDb, lang]));

  // Copy the verse of the day to the clipboard.
  const handleShareVerse = async () => {
    if (!vod) return;
    const ref = am ? vod.ref_am : vod.ref_en;
    const text = am ? vod.text_am : vod.text_en;
    try {
      // setStringAsync resolves false (not throws) when the write is refused,
      // e.g. on web without clipboard permission. Don't claim success then.
      const copied = await Clipboard.setStringAsync(`${text}\n— ${ref}`);
      if (copied) {
        showToast(t(lang, 'copiedToClipboard'), 'success');
      } else {
        reportError(new Error('Clipboard write was refused'), 'Today.handleShareVerse', lang);
      }
    } catch (err) {
      reportError(err, 'Today.handleShareVerse', lang);
    }
  };

  // Debounced search
  useEffect(() => {
    let active = true;

    if (!searchQuery.trim()) {
      setTimeout(() => setSearchResults([]), 0);
      return;
    }

    const timer = setTimeout(() => {
      searchBible(bibleDb, searchQuery)
        .then((res) => {
          // A query typed earlier must never replace the current query's hits.
          if (active) setSearchResults(res);
        })
        .catch((err) => {
          if (!active) return;
          setSearchResults([]);
          reportError(err, 'Today.searchBible', lang, false);
        });
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, bibleDb, lang]);

  const { showSkeleton: showTodaySkeleton } = useSkeleton({
    // Once the verse load has settled (success OR failure), stop showing the
    // skeleton even if there's no data, so a failed load can't spin forever.
    loading: !vodSettled,
    hasData: vod !== null,
  });

  const openInBible = (book: number, chapter: number, verse?: number) => {
    router.push({
      pathname: '/bible',
      params: { book: String(book), chapter: String(chapter), ...(verse ? { verse: String(verse) } : {}) },
    });
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
  };

  const fallbackText = am ? 'እግዚአብሔርም፦ ብርሃን ይሁን አለ፤ ብርሃንም ሆነ።' : 'And God said, Let there be light: and there was light.';
  const fallbackRef = am ? 'ኦሪት ዘፍጥረት ፩፥፫' : 'Genesis 1:3';
  const progress = lastRead && lastRead.chapters > 0 ? Math.min(1, lastRead.chapter / lastRead.chapters) : 0;

  return (
    <SafeAreaView style={[s.wrap, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      {showTodaySkeleton ? (
        <TodaySkeleton />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {/* Large title + the Ethiopian date — the date is the one thing on
              this screen that changes every morning besides the verse. */}
          <View style={s.top}>
            <View style={{ flex: 1 }}>
              <Text style={[s.date, { color: c.textSoft }]}>{ethDate}</Text>
              <Text
                style={[s.h1, { color: c.text, fontFamily: am ? fonts.amBold : fonts.serif }]}
                accessibilityRole="header"
              >
                {t(lang, 'today')}
              </Text>
            </View>
            <Pressable
              onPress={() => setSearchOpen(true)}
              style={[s.searchBtn, { backgroundColor: c.surface, borderColor: c.border }]}
              accessibilityRole="button"
              accessibilityLabel={t(lang, 'a11ySearch')}
              android_ripple={{ color: c.border, borderless: true, radius: 24 }}
            >
              <Icon name="search" size={21} color={c.text} />
            </Pressable>
          </View>

          {/* The verse of the day. Set as scripture, not as a card: the words
              are the content, gold is the light on them. */}
          <SectionBoundary name="Today.VOD">
            <View style={s.vod}>
              <View style={[s.vodRule, { backgroundColor: c.accent }]} />
              <Text style={[s.eyebrow, { color: c.accent }]}>{t(lang, 'dailyVerseTitle')}</Text>
              <Text style={[s.verse, am ? s.verseAm : s.verseEn, { color: c.text }]}>
                {vod ? (am ? vod.text_am : vod.text_en) : fallbackText}
              </Text>
              {am && (
                <Text style={[s.gloss, { color: c.textSoft }]}>
                  {vod ? vod.text_en : 'And God said, Let there be light: and there was light.'}
                </Text>
              )}
              <View style={s.verseFooter}>
                <Pressable
                  onPress={() => vod && openInBible(vod.book, vod.chapter, vod.verse)}
                  disabled={!vod}
                  accessibilityRole="link"
                  style={s.refBtn}
                >
                  <Text style={[s.ref, { color: c.accent }]}>
                    {vod ? (am ? vod.ref_am : vod.ref_en) : fallbackRef}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleShareVerse}
                  // Without a real `vod` the card shows a fallback; nothing to copy.
                  disabled={!vod}
                  accessibilityRole="button"
                  style={[s.copyBtn, { borderColor: c.border, opacity: vod ? 1 : 0.4 }]}
                  android_ripple={{ color: c.border }}
                >
                  <Icon name="copy" size={16} color={c.textSoft} />
                  <Text style={[s.copyTxt, { color: c.text }]}>{t(lang, 'copyVerse')}</Text>
                </Pressable>
              </View>
            </View>
          </SectionBoundary>

          {/* Continue reading — one grouped row, straight back to the chapter. */}
          <SectionBoundary name="Today.ContinueReading">
            <Text style={[s.sectionTitle, { color: c.textSoft }]} accessibilityRole="header">
              {t(lang, 'sectionReading')}
            </Text>
            <Pressable
              style={[s.row, { backgroundColor: c.surface, borderColor: c.border }]}
              onPress={() => (lastRead ? openInBible(lastRead.book, lastRead.chapter) : router.push('/bible'))}
              accessibilityRole="button"
              android_ripple={{ color: c.border }}
            >
              <View style={[s.iconBox, { backgroundColor: c.accentGlow }]}>
                <Icon name="book" size={20} color={c.accent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.rowTitle, { color: c.text }]}>{t(lang, 'continueReading')}</Text>
                <Text style={[s.rowSub, { color: c.textSoft }]} numberOfLines={2}>
                  {lastRead
                    ? `${am ? lastRead.name_am : lastRead.name_en} ${num(lastRead.chapter)} · ${num(lastRead.chapter)} / ${num(lastRead.chapters)}`
                    : t(lang, 'notStarted')}
                </Text>
                {lastRead && (
                  <View
                    style={[s.meter, { backgroundColor: c.border }]}
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: lastRead.chapters, now: lastRead.chapter }}
                  >
                    <View style={[s.meterFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: c.accent }]} />
                  </View>
                )}
              </View>
              <Icon name="chev" size={16} color={c.textSoft} />
            </Pressable>
          </SectionBoundary>
        </ScrollView>
      )}

      {/* Search — the same index the Bible tab searches; a result opens the
          verse itself, not just the Bible tab. */}
      <Modal visible={searchOpen} animationType="fade" onRequestClose={closeSearch}>
        <SafeAreaView style={[s.wrap, { backgroundColor: c.bg }]}>
          <View style={[s.searchHeader, { borderBottomColor: c.border }]}>
            <View style={[s.searchBarContainer, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Icon name="search" size={18} color={c.textSoft} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t(lang, 'searchPlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus
                returnKeyType="search"
                accessibilityLabel={t(lang, 'a11ySearch')}
                style={[s.searchInput, { color: c.text }]}
              />
            </View>
            <Pressable onPress={closeSearch} style={s.textBtn} accessibilityRole="button">
              <Text style={[s.textBtnTxt, { color: c.accent }]}>{t(lang, 'close')}</Text>
            </Pressable>
          </View>

          <SectionBoundary name="Today.Search">
            {searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(item, idx) => `${item.book}-${item.chapter}-${item.verse}-${idx}`}
                contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
                renderItem={({ item }) => (
                  <Pressable
                    style={[s.searchItem, { borderBottomColor: c.border }]}
                    onPress={() => {
                      closeSearch();
                      openInBible(item.book, item.chapter, item.verse);
                    }}
                    accessibilityRole="button"
                    android_ripple={{ color: c.border }}
                  >
                    <Text style={[s.searchRef, { color: c.accent }]}>
                      {am ? item.name_am : item.name_en} {num(item.chapter)}{am ? '፥' : ':'}{num(item.verse)}
                    </Text>
                    {item.text_am ? <Text style={[s.searchText, { color: c.text }]}>{item.text_am}</Text> : null}
                    {item.text_en ? <Text style={[s.searchTextEn, { color: c.textSoft }]}>{item.text_en}</Text> : null}
                  </Pressable>
                )}
              />
            ) : (
              <View style={s.searchEmpty}>
                <Icon name="search" size={32} color={c.textFaint} />
                <Text style={[s.emptyTxt, { color: c.textSoft }]}>
                  {searchQuery.trim() ? t(lang, 'noResults') : t(lang, 'searchHint')}
                </Text>
              </View>
            )}
          </SectionBoundary>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { paddingHorizontal: space.lg + 4, paddingBottom: 100 },

  top: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: space.lg, paddingBottom: space.md },
  date: { fontSize: 14, fontWeight: '600' },
  h1: { fontSize: 34, lineHeight: 46, fontWeight: '700' },
  searchBtn: {
    width: TARGET,
    height: TARGET,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },

  vod: { paddingTop: space.xl, paddingBottom: space.lg },
  vodRule: { width: 28, height: 3, borderRadius: 2, marginBottom: space.md },
  eyebrow: { fontSize: 14, fontWeight: '700' },
  verse: { marginTop: space.md },
  verseAm: { fontFamily: fonts.am, fontSize: 23, lineHeight: 42 },
  verseEn: { fontFamily: fonts.serif, fontSize: 23, lineHeight: 34 },
  gloss: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, marginTop: space.sm },
  verseFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
    gap: space.md,
  },
  refBtn: { minHeight: TARGET, justifyContent: 'center', flexShrink: 1 },
  ref: { fontSize: 15, fontWeight: '700' },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  copyTxt: { fontSize: 14, fontWeight: '600' },

  sectionTitle: { fontSize: 14, fontWeight: '600', marginTop: space.xl, marginBottom: space.sm, paddingHorizontal: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    minHeight: 72,
    overflow: 'hidden',
  },
  iconBox: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13, marginTop: 2 },
  meter: { height: 4, borderRadius: 99, overflow: 'hidden', marginTop: space.sm },
  meterFill: { height: '100%' },

  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBarContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 8, marginLeft: 8 },
  textBtn: { minHeight: TARGET, minWidth: TARGET, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  textBtnTxt: { fontSize: 16, fontWeight: '600' },
  searchItem: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  searchRef: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  searchText: { fontFamily: fonts.am, fontSize: 16, lineHeight: 28 },
  searchTextEn: { fontFamily: fonts.serif, fontSize: 14, lineHeight: 20, marginTop: 2 },
  searchEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  emptyTxt: { fontSize: 15, textAlign: 'center' },
});
