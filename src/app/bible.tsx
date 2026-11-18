import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Modal,
  TextInput,
  FlatList,
  Text,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSQLiteContext } from "expo-sqlite";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useApp } from "@/theme/context";
import { getLocalDb, runTransactionExclusive, saveReadingPosition } from "@/utils/db";
import { searchBible, VerseResult } from "@/utils/search";
import { Icon } from "@/components/icon";
import { toGeezNumeral } from "@/lib/ethiopian";
import { radius, fonts, space, TARGET, readerScale, type ReaderSize } from "@/theme/tokens";
import { t } from "@/i18n";
import type { ThemeMode } from "@/theme/context";
import { reportError } from "@/lib/errors";
import { BibleSkeleton } from "@/components/skeletons/bible-skeleton";
import { useSkeleton } from "@/lib/use-skeleton";
import { SectionBoundary } from "@/components/section-boundary";
import {
  VerseStudySheets,
  type StudyPanel,
  type StudyVerseRef,
  type NavigateTarget,
} from "@/components/verse-study/verse-study-sheets";
import { CoachMarks, type CoachStep } from "@/components/coach-marks";
import { hasSeenTour, markTourSeen } from "@/lib/coachTours";
import { AudioPlayerOverlay } from "@/components/audio/AudioPlayerOverlay";
import { downloadChapter } from "@/lib/audioDownload";
import { initAudioPlayer } from "@/lib/audioPlayer";

interface Book {
  id: number;
  name_am: string;
  name_en: string;
  testament: string;
  chapters: number;
}

interface Verse {
  verse: number;
  text_am: string;
  text_en: string;
  am_merge_head: number;
}

export default function BibleScreen() {
  const db = useSQLiteContext();
  const { c, lang, readingLang, setReadingLang, readerSize, setReaderSize, themeMode, setThemeMode } = useApp();
  // A verse to open, handed over by the Today screen's search.
  const params = useLocalSearchParams<{ book?: string; chapter?: string; verse?: string }>();
  const isAm = lang === 'am';

  // Navigation state
  const [activeTestament, setActiveTestament] = useState<"OT" | "NT">("OT");
  const [books, setBooks] = useState<Book[]>([]);
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [currentChapter, setCurrentChapter] = useState<number>(1);
  const [verses, setVerses] = useState<Verse[]>([]);

  // Local user state (highlights & bookmarks)
  const [highlights, setHighlights] = useState<Record<number, string>>({}); // verse -> color
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());

  // View state. The reading language is a stored app preference, not local
  // state — it is also settable from Settings, and it used to reset on every
  // launch because it lived only here.
  const viewMode = readingLang;
  const setViewMode = setReadingLang;
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [expandedBookId, setExpandedBookId] = useState<number | null>(null);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VerseResult[]>([]);

  // Audio player state
  const [audioPlayerVisible, setAudioPlayerVisible] = useState(false);
  const [audioDownloading, setAudioDownloading] = useState(false);

  // Selection state (clicked verse)
  const [loadingChapter, setLoadingChapter] = useState(false);

  // Long-press verse study (cross-refs / commentary / word study / copy / share)
  const [studyPanel, setStudyPanel] = useState<"actions" | StudyPanel | null>(null);
  const [studyVerseNum, setStudyVerseNum] = useState<number | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const pendingPosRef = useRef<{ book: number; chapter: number } | null>(null);
  const savePosTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // First-run coach-mark tour: spotlight the book picker, search, language
  // toggle, and a verse the first time this screen is opened. Measured live, so
  // the refs point at the real controls.
  const bookBtnRef = useRef<any>(null);
  const searchBtnRef = useRef<any>(null);
  const langBtnRef = useRef<any>(null);
  const firstVerseRef = useRef<any>(null);
  const [tourVisible, setTourVisible] = useState(false);

  const coachSteps: CoachStep[] = useMemo(() => [
    { targetRef: bookBtnRef, titleKey: 'coachBibleBookTitle', bodyKey: 'coachBibleBookBody' },
    { targetRef: searchBtnRef, titleKey: 'coachBibleSearchTitle', bodyKey: 'coachBibleSearchBody' },
    { targetRef: langBtnRef, titleKey: 'coachBibleLangTitle', bodyKey: 'coachBibleLangBody' },
    { targetRef: firstVerseRef, titleKey: 'coachBibleVerseTitle', bodyKey: 'coachBibleVerseBody' },
  ], []);

  const finishTour = useCallback(() => {
    setTourVisible(false);
    markTourSeen('bible');
  }, []);

  // Show the tour on first visit — and again after "Replay the guide" clears the
  // flag, since re-focusing the tab re-checks it. Checked on focus (not once)
  // and re-run when the data loads, so a still-loading first launch is covered.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (books.length === 0 || verses.length === 0 || tourVisible) return;
        const seen = await hasSeenTour('bible').catch(() => true);
        if (cancelled || seen) return;
        // Let the header and first verse settle into layout before measuring.
        setTimeout(() => { if (!cancelled) setTourVisible(true); }, 550);
      })();
      return () => { cancelled = true; };
    }, [books.length, verses.length, tourVisible]),
  );

  const flushReadingPosition = useCallback(async () => {
    const pos = pendingPosRef.current;
    if (!pos) return;
    pendingPosRef.current = null;
    try {
      await saveReadingPosition(pos.book, pos.chapter);
    } catch (err) {
      reportError(err, "BibleScreen.saveReadingPosition", lang, false);
    }
  }, [lang]);

  // Initialize audio player on mount
  useEffect(() => {
    initAudioPlayer().catch(err => reportError(err, "BibleScreen.initAudioPlayer", lang, false));
  }, [lang]);

  const handlePlayAudio = useCallback(async () => {
    if (!currentBook) return;
    
    setAudioDownloading(true);
    try {
      await downloadChapter(currentBook.id, currentChapter);
      setAudioPlayerVisible(true);
    } catch (err) {
      reportError(err instanceof Error ? err : new Error('Failed to load audio'), 'BibleScreen.playAudio');
    } finally {
      setAudioDownloading(false);
    }
  }, [currentBook, currentChapter]);

  const handleLoadAudioChapter = useCallback(async (bookId: number, chapter: number) => {
    try {
      await downloadChapter(bookId, chapter);
    } catch (err) {
      reportError(err instanceof Error ? err : new Error('Failed to load audio chapter'), 'BibleScreen.loadAudioChapter');
    }
  }, []);

  const { showSkeleton: showBibleSkeleton } = useSkeleton({
    loading: loadingChapter,
    hasData: verses.length > 0,
  });

  // Load books list & last reading position on mount
  useEffect(() => {
    async function init() {
      if (!db) {
        if (__DEV__) console.log("[BibleScreen] db handle is null/undefined during init");
        return;
      }
      try {
        if (__DEV__) {
          console.log("[BibleScreen] Executing init query: SELECT * FROM books ORDER BY id ASC");
        }
        const booksList = await db.getAllAsync<Book>("SELECT * FROM books ORDER BY id ASC");
        setBooks(booksList);

        const localDb = await getLocalDb();
        const lastPos = await localDb.getFirstAsync<{ book: number; chapter: number }>(
          "SELECT book, chapter FROM reading_position ORDER BY updated_at DESC LIMIT 1"
        );

        const askedBook = Number(params.book);
        const askedChapter = Number(params.chapter);
        const asked = booksList.find((b: Book) => b.id === askedBook);
        if (asked && askedChapter >= 1) {
          setCurrentBook(asked);
          setCurrentChapter(askedChapter);
        } else if (lastPos && typeof lastPos.book === 'number' && typeof lastPos.chapter === 'number' && booksList.length > 0) {
          const matchedBook = booksList.find((b: Book) => b.id === lastPos.book) || booksList[0];
          setCurrentBook(matchedBook);
          setCurrentChapter(lastPos.chapter ?? 1);
        } else if (booksList.length > 0) {
          setCurrentBook(booksList[0]);
          setCurrentChapter(1);
        }
      } catch (err) {
        reportError(err, "BibleScreen.init", lang, false);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, lang]);

  // Today's search hands a verse over through the route. The init above covers
  // a first visit; this covers a Bible tab that is already open.
  useEffect(() => {
    const b = books.find((bk) => bk.id === Number(params.book));
    const ch = Number(params.chapter);
    if (!b || !(ch >= 1)) return;
    setTimeout(() => {
      setCurrentBook(b);
      setCurrentChapter(ch);
      const v = Number(params.verse);
      if (v >= 1) setStudyVerseNum(v);
    }, 0);
  }, [params.book, params.chapter, params.verse, books]);

  // Load verses, highlights, and bookmarks when book/chapter changes
  useEffect(() => {
    if (!db || !currentBook || typeof currentBook.id !== 'number' || typeof currentChapter !== 'number' || isNaN(currentChapter)) {
      return;
    }
    const bookId = currentBook.id;
    const chapNum = Math.max(1, currentChapter);

    async function loadChapterContent() {
      setLoadingChapter(true);
      try {
        const sql = "SELECT verse, text_am, text_en, am_merge_head FROM verses WHERE book = ? AND chapter = ? ORDER BY verse ASC";
        const params = [bookId, chapNum];

        if (__DEV__) {
          console.log(`[BibleScreen] Executing SQL: ${sql} | Params:`, params);
        }

        if (params.some((p) => p === undefined || p === null || (typeof p === 'number' && isNaN(p)))) {
          console.warn("[BibleScreen] Prevented invalid bind parameter in loadChapterContent:", params);
          return;
        }

        const versesList = await db.getAllAsync<Verse>(sql, params);
        setVerses(versesList);

        const localDb = await getLocalDb();
        const highlightRows = await localDb.getAllAsync<{ verse: number; color: string }>(
          "SELECT verse, color FROM highlights WHERE book = ? AND chapter = ?",
          [bookId, chapNum]
        );
        const bookmarkRows = await localDb.getAllAsync<{ verse: number }>(
          "SELECT verse FROM bookmarks WHERE book = ? AND chapter = ?",
          [bookId, chapNum]
        );

        const highlightsMap: Record<number, string> = {};
        highlightRows.forEach((row: { verse: number; color: string }) => {
          if (row.verse != null && row.color) {
            highlightsMap[row.verse] = row.color;
          }
        });
        setHighlights(highlightsMap);

        const bookmarksSet = new Set<number>();
        bookmarkRows.forEach((row: { verse: number }) => {
          if (row.verse != null) {
            bookmarksSet.add(row.verse);
          }
        });
        setBookmarks(bookmarksSet);

        scrollViewRef.current?.scrollTo({ y: 0, animated: false });
      } catch (err) {
        reportError(err, "BibleScreen.loadChapterContent", lang);
      } finally {
        setLoadingChapter(false);
      }
    }

    loadChapterContent();
  }, [currentBook, currentChapter, db, lang]);

  // Debounced save reading position to the writable local DB (not bible_v3.db).
  useEffect(() => {
    if (!currentBook || typeof currentBook.id !== 'number' || typeof currentChapter !== 'number' || isNaN(currentChapter)) {
      return;
    }
    const bookId = currentBook.id;
    const chapNum = Math.max(1, currentChapter);

    pendingPosRef.current = { book: bookId, chapter: chapNum };
    if (savePosTimerRef.current) clearTimeout(savePosTimerRef.current);
    savePosTimerRef.current = setTimeout(() => {
      savePosTimerRef.current = null;
      flushReadingPosition();
    }, 500);

    return () => {
      if (savePosTimerRef.current) {
        clearTimeout(savePosTimerRef.current);
        savePosTimerRef.current = null;
      }
    };
  }, [currentBook, currentChapter, flushReadingPosition]);

  // Flush pending position when leaving the Bible tab so nothing is lost.
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (savePosTimerRef.current) {
          clearTimeout(savePosTimerRef.current);
          savePosTimerRef.current = null;
        }
        flushReadingPosition();
      };
    }, [flushReadingPosition]),
  );

  // Handle highlights
  const handleHighlight = async (color: string | null) => {
    if (!currentBook || studyVerseNum === null) return;

    try {
      const localDb = await getLocalDb();
      const id = `${currentBook.id}-${currentChapter}-${studyVerseNum}`;
      await runTransactionExclusive(localDb, async (txn) => {
        if (color) {
          await txn.runAsync(
            "INSERT OR REPLACE INTO highlights (id, book, chapter, verse, color, note, updated_at, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [id, currentBook.id, currentChapter, studyVerseNum, color, null, Date.now(), 0]
          );
        } else {
          await txn.runAsync("DELETE FROM highlights WHERE id = ?", [id]);
        }
      });

      if (color) {
        setHighlights(prev => ({ ...prev, [studyVerseNum]: color }));
      } else {
        setHighlights(prev => {
          const copy = { ...prev };
          delete copy[studyVerseNum];
          return copy;
        });
      }
      closeStudySheets();
    } catch (err) {
      reportError(err, "BibleScreen.handleHighlight", lang);
    }
  };

  // Handle Bookmarks
  const toggleBookmark = async () => {
    if (!currentBook || studyVerseNum === null) return;

    const isBookmarked = bookmarks.has(studyVerseNum);
    const id = `${currentBook.id}-${currentChapter}-${studyVerseNum}`;

    try {
      const localDb = await getLocalDb();
      await runTransactionExclusive(localDb, async (txn) => {
        if (isBookmarked) {
          await txn.runAsync("DELETE FROM bookmarks WHERE id = ?", [id]);
        } else {
          await txn.runAsync(
            "INSERT OR REPLACE INTO bookmarks (id, book, chapter, verse, updated_at, synced) VALUES (?, ?, ?, ?, ?, ?)",
            [id, currentBook.id, currentChapter, studyVerseNum, Date.now(), 0]
          );
        }
      });

      if (isBookmarked) {
        setBookmarks(prev => {
          const copy = new Set(prev);
          copy.delete(studyVerseNum);
          return copy;
        });
      } else {
        setBookmarks(prev => {
          const copy = new Set(prev);
          copy.add(studyVerseNum);
          return copy;
        });
      }
      closeStudySheets();
    } catch (err) {
      reportError(err, "BibleScreen.toggleBookmark", lang);
    }
  };

  // Search debounced
  useEffect(() => {
    if (!searchQuery.trim()) {
      setTimeout(() => setSearchResults([]), 0);
      return;
    }
    const delayDebounceFn = setTimeout(async () => {
      const results = await searchBible(db, searchQuery);
      setSearchResults(results);
    }, 200);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, db]);

  const handleSelectSearchResult = (result: VerseResult) => {
    const matchedBook = books.find(b => b.id === result.book);
    if (matchedBook) {
      setCurrentBook(matchedBook);
      setCurrentChapter(result.chapter);
      setSearchOpen(false);
      setSearchQuery("");
      setTimeout(() => {
        setStudyVerseNum(result.verse);
      }, 300);
    }
  };

  const studyVerseRef: StudyVerseRef | null = useMemo(() => {
    if (studyVerseNum === null || !currentBook) return null;
    const v = verses.find((vv) => vv.verse === studyVerseNum);
    if (!v) return null;
    return {
      book: currentBook.id,
      bookNameAm: currentBook.name_am,
      bookNameEn: currentBook.name_en,
      chapter: currentChapter,
      verse: studyVerseNum,
      textAm: v.text_am,
      textEn: v.text_en,
    };
  }, [studyVerseNum, currentBook, currentChapter, verses]);

  const closeStudySheets = () => {
    setStudyPanel(null);
    setStudyVerseNum(null);
  };

  const handleStudyNavigate = (target: NavigateTarget) => {
    const matchedBook = books.find((b) => b.id === target.book);
    if (matchedBook) {
      setCurrentBook(matchedBook);
      setCurrentChapter(target.chapter);
      closeStudySheets();
      setTimeout(() => {
        setStudyVerseNum(target.verse);
      }, 300);
    }
  };

  // Next/Prev Chapter
  const nextChapter = () => {
    if (!currentBook) return;
    if (currentChapter < currentBook.chapters) {
      setCurrentChapter(currentChapter + 1);
    } else {
      const nextIndex = books.findIndex(b => b.id === currentBook.id) + 1;
      if (nextIndex < books.length) {
        setCurrentBook(books[nextIndex]);
        setCurrentChapter(1);
      }
    }
  };

  const prevChapter = () => {
    if (!currentBook) return;
    if (currentChapter > 1) {
      setCurrentChapter(currentChapter - 1);
    } else {
      const prevIndex = books.findIndex(b => b.id === currentBook.id) - 1;
      if (prevIndex >= 0) {
        const prevBook = books[prevIndex];
        setCurrentBook(prevBook);
        setCurrentChapter(prevBook.chapters);
      }
    }
  };

  const highlightColors = [
    { name: "Gold", hex: "rgba(227,169,60,0.25)" },
    { name: "Green", hex: "rgba(95,167,113,0.25)" },
    { name: "Lapis", hex: "rgba(91,139,208,0.25)" },
    { name: "Red", hex: "rgba(210,86,75,0.25)" },
  ];

  // Where the chapter buttons go, named — "Genesis 3", not "Next".
  const bookIndex = currentBook ? books.findIndex((b) => b.id === currentBook.id) : -1;
  const prevTarget = !currentBook
    ? null
    : currentChapter > 1
      ? { book: currentBook, chapter: currentChapter - 1 }
      : bookIndex > 0
        ? { book: books[bookIndex - 1], chapter: books[bookIndex - 1].chapters }
        : null;
  const nextTarget = !currentBook
    ? null
    : currentChapter < currentBook.chapters
      ? { book: currentBook, chapter: currentChapter + 1 }
      : bookIndex >= 0 && bookIndex < books.length - 1
        ? { book: books[bookIndex + 1], chapter: 1 }
        : null;
  const numeral = (n: number) => (isAm ? toGeezNumeral(n) : String(n));
  const bookName = (b: Book) => (isAm ? b.name_am : b.name_en);

  // Scripture sizes follow the reader's own text-size choice, on top of the
  // phone's font-size setting (which RN applies to every Text already).
  const k = readerScale[readerSize];
  const amStyle = { fontFamily: fonts.am, fontSize: Math.round(19 * k), lineHeight: Math.round(35 * k), color: c.text };
  const enStyle = { fontFamily: fonts.serif, fontSize: Math.round(17 * k), lineHeight: Math.round(28 * k), color: c.text };
  const numStyle = { fontFamily: fonts.amBold, fontSize: Math.round(13 * k), color: c.accent };

  const shownVerses = verses.filter((v) =>
    viewMode === "am" ? v.verse === v.am_merge_head && v.text_am !== "" : true,
  );

  const openVerse = (n: number) => {
    setStudyVerseNum(n);
    setStudyPanel("actions");
  };

  /**
   * The KJV source marks words the translators supplied as {word} — printed
   * Bibles set them in italics — and carries marginal notes inline as
   * {word: Heb. note}. Show the first as italics, drop the second.
   */
  const kjv = (text: string) =>
    text
      .replace(/\s*\{[^{}]*:[^{}]*\}/g, "")
      .split(/(\{[^{}]*\})/)
      .filter(Boolean)
      .map((part, i) =>
        part.startsWith("{") ? (
          <Text key={i} style={{ fontStyle: "italic" }}>{part.slice(1, -1)}</Text>
        ) : (
          part
        ),
      );

  /** One verse as a run of text inside the paragraph: numeral, then words. */
  const verseSpan = (v: Verse, text: string, base: object) => {
    const selected = studyVerseNum === v.verse;
    const hl = highlights[v.verse];
    const marked = bookmarks.has(v.verse);
    return (
      <Text
        key={v.verse}
        onPress={() => openVerse(v.verse)}
        suppressHighlighting
        accessibilityRole="button"
        accessibilityLabel={`${numeral(v.verse)}${marked ? `, ${t(lang, "a11yBookmarked")}` : ""}. ${text.replace(/\s*\{[^{}]*:[^{}]*\}/g, "").replace(/[{}]/g, "")}`}
        style={[
          base,
          hl ? { backgroundColor: hl } : null,
          selected ? { backgroundColor: c.accentGlow, textDecorationLine: "underline", textDecorationColor: c.accent } : null,
        ]}
      >
        <Text
          style={[
            numStyle,
            marked ? { color: c.onAccent, backgroundColor: c.accent } : null,
          ]}
        >
          {marked ? ` ${numeral(v.verse)} ` : numeral(v.verse)}
        </Text>
        {" "}
        {base === enStyle ? kjv(text) : text}
        {"  "}
      </Text>
    );
  };

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: "dark", label: t(lang, "themeDark") },
    { value: "light", label: t(lang, "themeLight") },
    { value: "system", label: t(lang, "themeSystem") },
  ];
  const sizeOptions: ReaderSize[] = ["sm", "md", "lg", "xl"];

  return (
    <SafeAreaView style={[styles.outer, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      {/* Toolbar. The reference is the title and the way to change it — the
          familiar "tap the title to choose" pattern, with a chevron to say so. */}
      <SectionBoundary name="Bible.Nav">
        <View style={[styles.header, { borderBottomColor: c.border, backgroundColor: c.bg }]}>
          <Pressable
            ref={bookBtnRef}
            onPress={() => setSelectorOpen(true)}
            style={styles.headerRef}
            accessibilityRole="button"
            accessibilityLabel={`${currentBook ? bookName(currentBook) : ""} ${numeral(currentChapter)}. ${t(lang, "a11yChooseChapter")}`}
            android_ripple={{ color: c.border, borderless: false }}
          >
            <Text style={[styles.headerTitle, { color: c.text }, isAm && styles.headerTitleAm]} numberOfLines={1}>
              {currentBook ? bookName(currentBook) : ""} {numeral(currentChapter)}
            </Text>
            <Icon name="chevDown" size={16} color={c.textSoft} />
          </Pressable>

          <Pressable
            ref={searchBtnRef}
            onPress={() => setSearchOpen(true)}
            style={styles.toolBtn}
            accessibilityRole="button"
            accessibilityLabel={t(lang, "a11ySearch")}
            android_ripple={{ color: c.border, borderless: true, radius: 24 }}
          >
            <Icon name="search" size={22} color={c.text} />
          </Pressable>
          <Pressable
            ref={langBtnRef}
            onPress={() => setLangOpen(true)}
            style={styles.toolBtn}
            accessibilityRole="button"
            accessibilityLabel={t(lang, "a11yReadingOptions")}
            android_ripple={{ color: c.border, borderless: true, radius: 24 }}
          >
            <Icon name="textSize" size={22} color={c.text} />
          </Pressable>
          <Pressable
            onPress={handlePlayAudio}
            disabled={!currentBook || audioDownloading}
            style={styles.toolBtn}
            accessibilityRole="button"
            accessibilityLabel={t(lang, "audioPlayer")}
            android_ripple={{ color: c.border, borderless: true, radius: 24 }}
          >
            <Icon name={audioDownloading ? "loading" : "play"} size={22} color={c.accent} />
          </Pressable>
        </View>
      </SectionBoundary>

      {/* The page. No card around scripture: the text is the content, and it
          gets the whole width. */}
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.page}>
        <SectionBoundary name="Bible.ChapterContent" skeleton={<BibleSkeleton />}>
          {showBibleSkeleton ? (
            <BibleSkeleton />
          ) : (
            <View>
              {/* Chapter opening — the one ornamental moment. A manuscript
                  marks a new chapter; so does this, with the numeral in gold
                  between two rules. */}
              <View style={styles.incipit} accessibilityRole="header">
                <Text style={[styles.incipitBook, { color: c.textSoft }, isAm && { fontFamily: fonts.am }]}>
                  {currentBook ? bookName(currentBook) : ""}
                </Text>
                <View style={styles.incipitRow}>
                  <View style={[styles.rule, { backgroundColor: c.accentDim }]} />
                  <Text style={[styles.incipitNum, { color: c.accent, fontFamily: isAm ? fonts.amBold : fonts.serif }]}>
                    {numeral(currentChapter)}
                  </Text>
                  <View style={[styles.rule, { backgroundColor: c.accentDim }]} />
                </View>
              </View>

              <View ref={firstVerseRef} collapsable={false}>
                {viewMode === "both" ? (
                  shownVerses.map((v) => (
                    <View key={v.verse} style={styles.pair}>
                      {v.text_am !== "" && v.verse === v.am_merge_head ? (
                        <Text>{verseSpan(v, v.text_am, amStyle)}</Text>
                      ) : null}
                      <Text
                        onPress={() => openVerse(v.verse)}
                        suppressHighlighting
                        style={[enStyle, styles.pairEn, { color: c.textSoft }]}
                      >
                        {v.text_am === "" || v.verse !== v.am_merge_head ? (
                          <Text style={numStyle}>{v.verse} </Text>
                        ) : null}
                        {kjv(v.text_en)}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={viewMode === "am" ? amStyle : enStyle}>
                    {shownVerses.map((v) =>
                      verseSpan(v, viewMode === "am" ? v.text_am : v.text_en, viewMode === "am" ? amStyle : enStyle),
                    )}
                  </Text>
                )}
              </View>
            </View>
          )}
        </SectionBoundary>

        {/* End of chapter: where the two buttons go, by name. */}
        <SectionBoundary name="Bible.Navigation">
          <View style={[styles.navRow, { borderTopColor: c.border }]}>
            {prevTarget ? (
              <Pressable
                onPress={prevChapter}
                style={[styles.navBtn, { backgroundColor: c.surface, borderColor: c.border }]}
                accessibilityRole="button"
                accessibilityLabel={`${t(lang, "a11yPrevChapter")}: ${bookName(prevTarget.book)} ${numeral(prevTarget.chapter)}`}
                android_ripple={{ color: c.border }}
              >
                <Icon name="back" size={16} color={c.textSoft} />
                <Text style={[styles.navTxt, { color: c.text }]} numberOfLines={1}>
                  {bookName(prevTarget.book)} {numeral(prevTarget.chapter)}
                </Text>
              </Pressable>
            ) : <View style={{ flex: 1 }} />}
            {nextTarget ? (
              <Pressable
                onPress={nextChapter}
                style={[styles.navBtn, styles.navBtnNext, { backgroundColor: c.surface, borderColor: c.border }]}
                accessibilityRole="button"
                accessibilityLabel={`${t(lang, "a11yNextChapter")}: ${bookName(nextTarget.book)} ${numeral(nextTarget.chapter)}`}
                android_ripple={{ color: c.border }}
              >
                <Text style={[styles.navTxt, { color: c.text }]} numberOfLines={1}>
                  {bookName(nextTarget.book)} {numeral(nextTarget.chapter)}
                </Text>
                <Icon name="chev" size={16} color={c.textSoft} />
              </Pressable>
            ) : <View style={{ flex: 1 }} />}
          </View>
        </SectionBoundary>
      </ScrollView>

      {/* Reading options — a bottom sheet, the way reading apps put "Aa":
          language, text size, and light or dark, all in one reach. */}
      <Modal visible={langOpen} animationType="slide" transparent onRequestClose={() => setLangOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setLangOpen(false)} accessibilityLabel={t(lang, "close")} />
        <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.grabber, { backgroundColor: c.borderLit }]} />
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetTitle, { color: c.text }]}>{t(lang, "readingOptions")}</Text>
            <Pressable onPress={() => setLangOpen(false)} style={styles.textBtn} accessibilityRole="button">
              <Text style={[styles.textBtnTxt, { color: c.accent }]}>{t(lang, "done")}</Text>
            </Pressable>
          </View>

          <Text style={[styles.sheetLabel, { color: c.textSoft }]}>{t(lang, "readingLanguageLabel")}</Text>
          <Segmented
            c={c}
            value={viewMode}
            onChange={(v) => setViewMode(v as any)}
            options={[
              { value: "am", label: "አማርኛ" },
              { value: "en", label: "English" },
              { value: "both", label: t(lang, "readingBoth") },
            ]}
          />

          <Text style={[styles.sheetLabel, { color: c.textSoft }]}>{t(lang, "textSize")}</Text>
          <Segmented
            c={c}
            value={readerSize}
            onChange={(v) => setReaderSize(v as ReaderSize)}
            options={sizeOptions.map((sz) => ({
              value: sz,
              label: "ሀ",
              labelStyle: { fontFamily: fonts.am, fontSize: Math.round(15 * readerScale[sz]) },
              a11y: `${t(lang, "textSize")} ${sizeOptions.indexOf(sz) + 1}`,
            }))}
          />

          <Text style={[styles.sheetLabel, { color: c.textSoft }]}>{t(lang, "themeLabel")}</Text>
          <Segmented
            c={c}
            value={themeMode}
            onChange={(v) => setThemeMode(v as ThemeMode)}
            options={themeOptions}
          />
        </View>
      </Modal>

      {/* Book & chapter picker */}
      <Modal visible={selectorOpen} animationType="slide" onRequestClose={() => setSelectorOpen(false)}>
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: c.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
            <Text style={[styles.sheetTitle, { color: c.text }]}>{t(lang, "selectBook")}</Text>
            <Pressable onPress={() => setSelectorOpen(false)} style={styles.textBtn} accessibilityRole="button">
              <Text style={[styles.textBtnTxt, { color: c.accent }]}>{t(lang, "close")}</Text>
            </Pressable>
          </View>

          <View style={styles.modalBody}>
            <Segmented
              c={c}
              value={activeTestament}
              onChange={(v) => {
                setActiveTestament(v as "OT" | "NT");
                setExpandedBookId(null);
              }}
              options={[
                { value: "OT", label: t(lang, "oldTestament") },
                { value: "NT", label: t(lang, "newTestament") },
              ]}
            />
          </View>

          <FlatList
            data={books.filter((b) => b.testament === activeTestament)}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.bookList}
            renderItem={({ item }) => {
              const isExpanded = expandedBookId === item.id;
              const isCurrent = currentBook?.id === item.id;
              return (
                <View style={[styles.bookItem, { borderBottomColor: c.border }]}>
                  <Pressable
                    onPress={() => setExpandedBookId(isExpanded ? null : item.id)}
                    style={styles.bookItemHeader}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isExpanded }}
                    android_ripple={{ color: c.border }}
                  >
                    <Text style={[styles.bookName, { color: isCurrent ? c.accent : c.text }]}>
                      {bookName(item)}
                    </Text>
                    <Text style={[styles.bookCount, { color: c.textSoft }]}>{numeral(item.chapters)}</Text>
                    <Icon name={isExpanded ? "chevDown" : "chev"} size={16} color={c.textSoft} />
                  </Pressable>

                  {isExpanded && (
                    <View style={styles.chaptersGrid}>
                      {Array.from({ length: item.chapters }, (_, i) => i + 1).map((ch) => {
                        const here = isCurrent && currentChapter === ch;
                        return (
                          <Pressable
                            key={ch}
                            onPress={() => {
                              setCurrentBook(item);
                              setCurrentChapter(ch);
                              setSelectorOpen(false);
                              setExpandedBookId(null);
                            }}
                            style={[
                              styles.chapterCell,
                              { backgroundColor: here ? c.accent : c.surface, borderColor: here ? c.accent : c.border },
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: here }}
                          >
                            <Text style={[styles.chapterTxt, { color: here ? c.onAccent : c.text }]}>
                              {numeral(ch)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            }}
          />
        </SafeAreaView>
      </Modal>

      {/* Search */}
      <Modal
        visible={searchOpen}
        animationType="fade"
        onRequestClose={() => {
          setSearchOpen(false);
          setSearchQuery("");
          setSearchResults([]);
        }}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: c.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
            <View style={[styles.searchBarContainer, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Icon name="search" size={18} color={c.textSoft} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t(lang, "searchPlaceholder")}
                placeholderTextColor={c.textFaint}
                autoFocus
                returnKeyType="search"
                accessibilityLabel={t(lang, "a11ySearch")}
                style={[styles.searchInput, { color: c.text }]}
              />
            </View>
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setSearchQuery("");
                setSearchResults([]);
              }}
              style={styles.textBtn}
              accessibilityRole="button"
            >
              <Text style={[styles.textBtnTxt, { color: c.accent }]}>{t(lang, "close")}</Text>
            </Pressable>
          </View>

          <SectionBoundary name="Bible.Search">
            {searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(item, idx) => `${item.book}-${item.chapter}-${item.verse}-${idx}`}
                contentContainerStyle={styles.searchResultsContainer}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => handleSelectSearchResult(item)}
                    style={[styles.searchResultItem, { borderBottomColor: c.border }]}
                    accessibilityRole="button"
                    android_ripple={{ color: c.border }}
                  >
                    <Text style={[styles.resultRef, { color: c.accent }]}>
                      {isAm ? item.name_am : item.name_en} {numeral(item.chapter)}{isAm ? "፥" : ":"}{numeral(item.verse)}
                    </Text>
                    {item.text_am ? (
                      <Text style={[styles.resultAm, { color: c.text }]}>{item.text_am}</Text>
                    ) : null}
                    {item.text_en ? (
                      <Text style={[styles.resultEn, { color: c.textSoft }]}>{item.text_en}</Text>
                    ) : null}
                  </Pressable>
                )}
              />
            ) : (
              <View style={styles.searchEmptyContainer}>
                <Icon name="search" size={32} color={c.textFaint} />
                <Text style={[styles.emptyTxt, { color: c.textSoft }]}>
                  {searchQuery.trim() ? t(lang, "noResults") : t(lang, "searchHint")}
                </Text>
              </View>
            )}
          </SectionBoundary>
        </SafeAreaView>
      </Modal>

      <VerseStudySheets
        verseRef={studyVerseRef}
        panel={studyPanel}
        bibleDb={db}
        books={books}
        lang={lang}
        colors={c}
        onClose={closeStudySheets}
        onOpenPanel={(panel) => setStudyPanel(panel)}
        onNavigate={handleStudyNavigate}
        highlightColors={highlightColors}
        activeHighlight={studyVerseNum !== null ? highlights[studyVerseNum] ?? null : null}
        onHighlight={handleHighlight}
        isBookmarked={studyVerseNum !== null && bookmarks.has(studyVerseNum)}
        onToggleBookmark={toggleBookmark}
      />

      <CoachMarks c={c} lang={lang} steps={coachSteps} visible={tourVisible} onDone={finishTour} />

      <AudioPlayerOverlay
        visible={audioPlayerVisible}
        onClose={() => setAudioPlayerVisible(false)}
        onLoadChapter={handleLoadAudioChapter}
        currentBook={currentBook?.id ?? null}
        currentChapter={currentChapter}
        books={books}
      />
    </SafeAreaView>
  );
}

/**
 * A segmented control — two to four mutually exclusive choices in one row,
 * the selected one filled. Familiar on both platforms; each segment is a full
 * 48-dp target and announces itself as a radio choice.
 */
function Segmented({
  c,
  value,
  options,
  onChange,
}: {
  c: ReturnType<typeof useApp>["c"];
  value: string;
  options: { value: string; label: string; labelStyle?: object; a11y?: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <View style={[styles.segment, { backgroundColor: c.surfaceAlt }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, on && { backgroundColor: c.bg, borderColor: c.borderLit, borderWidth: StyleSheet.hairlineWidth }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.a11y}
          >
            <Text style={[styles.segmentTxt, { color: on ? c.text : c.textSoft }, on && styles.segmentTxtOn, o.labelStyle]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },

  // Toolbar
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: space.sm,
    paddingRight: space.xs,
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRef: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: TARGET,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  headerTitle: { fontSize: 18, fontWeight: "700", flexShrink: 1 },
  headerTitleAm: { fontFamily: fonts.amBold, fontWeight: undefined },
  toolBtn: { width: TARGET, height: TARGET, alignItems: "center", justifyContent: "center" },

  // Page
  page: { paddingHorizontal: space.xl - 2, paddingTop: space.lg, paddingBottom: 120 },
  incipit: { alignItems: "center", marginBottom: space.xl, marginTop: space.sm },
  incipitBook: { fontSize: 15, letterSpacing: 0.3 },
  incipitRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: 2 },
  rule: { width: 40, height: StyleSheet.hairlineWidth * 2 },
  incipitNum: { fontSize: 44, lineHeight: 60 },
  pair: { marginBottom: space.lg },
  pairEn: { marginTop: 2 },

  // End of chapter
  navRow: {
    flexDirection: "row",
    gap: space.md,
    marginTop: space.xxl,
    paddingTop: space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  navBtnNext: { justifyContent: "flex-end" },
  navTxt: { fontSize: 15, fontWeight: "600", flexShrink: 1 },

  // Reading options sheet
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
  },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginTop: space.sm },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TARGET + 4 },
  sheetTitle: { fontSize: 18, fontWeight: "700" },
  sheetLabel: { fontSize: 13, fontWeight: "600", marginTop: space.lg, marginBottom: space.sm },
  textBtn: { minHeight: TARGET, minWidth: TARGET, alignItems: "center", justifyContent: "center", paddingHorizontal: space.sm },
  textBtnTxt: { fontSize: 16, fontWeight: "600" },

  segment: { flexDirection: "row", borderRadius: radius.md, padding: 3, gap: 3 },
  segmentItem: {
    flex: 1,
    minHeight: TARGET - 4,
    borderRadius: radius.sm + 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  segmentTxt: { fontSize: 15 },
  segmentTxtOn: { fontWeight: "600" },

  // Picker
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: space.lg,
    paddingRight: space.sm,
    minHeight: 56,
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalBody: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  bookList: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  bookItem: { borderBottomWidth: StyleSheet.hairlineWidth },
  bookItemHeader: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 54 },
  bookName: { flex: 1, fontSize: 17 },
  bookCount: { fontSize: 13 },
  chaptersGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: space.lg },
  chapterCell: {
    width: TARGET,
    height: TARGET,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  chapterTxt: { fontSize: 15, fontWeight: "600" },

  // Search
  searchBarContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 8, marginLeft: 8 },
  searchResultsContainer: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  searchResultItem: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  resultRef: { fontSize: 13, fontWeight: "700", marginBottom: 4 },
  resultAm: { fontFamily: fonts.am, fontSize: 16, lineHeight: 28 },
  resultEn: { fontFamily: fonts.serif, fontSize: 14, lineHeight: 20, marginTop: 2 },
  searchEmptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: space.md, padding: space.xl },
  emptyTxt: { fontSize: 15, textAlign: "center" },
});
