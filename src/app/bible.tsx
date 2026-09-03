import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSQLiteContext } from "expo-sqlite";
import { useFocusEffect } from "expo-router";
import { useApp } from "@/theme/context";
import { getLocalDb, runTransactionExclusive, saveReadingPosition } from "@/utils/db";
import { searchBible, VerseResult } from "@/utils/search";
import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/icon";
import { toGeezNumeral } from "@/lib/ethiopian";
import { radius, fonts, space } from "@/theme/tokens";
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
  const { c, lang, readingLang, setReadingLang } = useApp();
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

  // Selection state (clicked verse)
  const [loadingChapter, setLoadingChapter] = useState(false);

  // Long-press verse study (cross-refs / commentary / word study / copy / share)
  const [studyPanel, setStudyPanel] = useState<"actions" | StudyPanel | null>(null);
  const [studyVerseNum, setStudyVerseNum] = useState<number | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const pendingPosRef = useRef<{ book: number; chapter: number } | null>(null);
  const savePosTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const { showSkeleton: showBibleSkeleton, timedOut: bibleTimedOut } = useSkeleton({
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

        if (lastPos && typeof lastPos.book === 'number' && typeof lastPos.chapter === 'number' && booksList.length > 0) {
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
  }, [db, lang]);

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
      setSearchResults([]);
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

  return (
    <SafeAreaView style={[styles.outer, { backgroundColor: c.bg }]}>
      {/* Top Header */}
      <SectionBoundary name="Bible.Nav">
        <View style={[styles.header, { borderBottomColor: c.border, backgroundColor: c.bg }]}>
          {/* Where you are, kept as plain text rather than a card. Something has
              to say which chapter is on screen, and this is the smallest thing
              that can. Tapping it opens the same picker as the book button. */}
          <TouchableOpacity
            onPress={() => setSelectorOpen(true)}
            style={styles.headerRef}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <ThemedText type="smallBold" colorType="text" isAmharic={isAm} numberOfLines={1}>
              {currentBook ? (isAm ? currentBook.name_am : currentBook.name_en) : ""}{" "}
              {isAm ? toGeezNumeral(currentChapter) : currentChapter}
            </ThemedText>
          </TouchableOpacity>

          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => setSelectorOpen(true)}
              style={[styles.iconbtn, { borderColor: c.border, backgroundColor: c.surface }]}
              accessibilityRole="button"
              accessibilityLabel={isAm ? "መጽሐፍ ይምረጡ" : "Select book"}
            >
              <Icon name="book" size={17} color={c.textSoft} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSearchOpen(true)}
              style={[styles.iconbtn, { borderColor: c.border, backgroundColor: c.surface }]}
              accessibilityRole="button"
              accessibilityLabel={isAm ? "ፈልግ" : "Search"}
            >
              <Icon name="search" size={17} color={c.textSoft} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setLangOpen(true)}
              style={[styles.iconbtn, { borderColor: c.border, backgroundColor: c.surface }]}
              accessibilityRole="button"
              accessibilityLabel={isAm ? "ቋንቋ" : "Language"}
            >
              <Icon name="globe" size={17} color={c.textSoft} />
            </TouchableOpacity>
          </View>
        </View>
      </SectionBoundary>

      {/* Reader Layout Scroll */}
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.versesContainer}>
        {/* Verse Cards Container */}
        <SectionBoundary name="Bible.ChapterContent" skeleton={<BibleSkeleton />}>
          {showBibleSkeleton ? (
            <BibleSkeleton />
          ) : (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              {verses
                .filter((v) => {
                  if (viewMode === "am") {
                    return v.verse === v.am_merge_head && v.text_am !== "";
                  }
                  return true;
                })
                .map((v) => {
                  const isSelected = studyVerseNum === v.verse;
                  const highlightColor = highlights[v.verse];
                  const isBookmarked = bookmarks.has(v.verse);

                  return (
                    <TouchableOpacity
                      key={v.verse}
                      activeOpacity={0.7}
                      onPress={() => {
                        setStudyVerseNum(v.verse);
                        setStudyPanel("actions");
                      }}
                      style={[
                        styles.verseItem,
                        isSelected && { backgroundColor: c.surfaceAlt, borderColor: c.accent },
                        !!highlightColor && { backgroundColor: highlightColor },
                      ]}
                    >
                      {/* Verse Number & Icons */}
                      <View style={styles.vnumRow}>
                        <ThemedText
                          type="smallBold"
                          colorType={isSelected ? "accent" : "textFaint"}
                          isAmharic={true}
                        >
                          {toGeezNumeral(v.verse)}
                        </ThemedText>
                        {isBookmarked && (
                          <View style={{ marginLeft: 4 }}>
                            <Icon name="bookmark" size={12} color={c.accent} />
                          </View>
                        )}
                      </View>

                      {/* Text Columns */}
                      {(viewMode === "am" || viewMode === "both") && (
                        <ThemedText
                          type="verse"
                          colorType="text"
                          isAmharic={true}
                          style={styles.amText}
                        >
                          {v.text_am}
                        </ThemedText>
                      )}

                      {(viewMode === "en" || viewMode === "both") && (
                        <ThemedText
                          type="verse"
                          colorType={viewMode === "both" ? "textSoft" : "text"}
                          isAmharic={false}
                          style={[styles.enText, viewMode === "both" && { fontStyle: "italic", fontSize: 14 }]}
                        >
                          {v.text_en}
                        </ThemedText>
                      )}
                    </TouchableOpacity>
                  );
                })}
            </View>
          )}
        </SectionBoundary>

        {/* Bottom Prev/Next Controls */}
        <SectionBoundary name="Bible.Navigation">
          <View style={styles.navRow}>
            <TouchableOpacity
              onPress={prevChapter}
              style={[styles.navBtn, { borderColor: c.border, backgroundColor: c.surface }]}
            >
              <View style={{ transform: [{ rotate: '180deg' }] }}>
                <Icon name="chev" size={14} color={c.textSoft} />
              </View>
              <ThemedText type="smallBold" colorType="text" style={{ marginLeft: 6 }}>
                {isAm ? "ቀዳሚ ምዕራፍ" : "Prev Chapter"}
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={nextChapter}
              style={[styles.navBtn, { borderColor: c.border, backgroundColor: c.surface }]}
            >
              <ThemedText type="smallBold" colorType="text" style={{ marginRight: 6 }}>
                {isAm ? "ቀጣይ ምዕራፍ" : "Next Chapter"}
              </ThemedText>
              <Icon name="chev" size={14} color={c.textSoft} />
            </TouchableOpacity>
          </View>
        </SectionBoundary>
      </ScrollView>

      {/* Language. The same three choices the segmented control offered, moved
          behind the globe icon so the names are not permanently on screen. */}
      <Modal visible={langOpen} animationType="fade" transparent onRequestClose={() => setLangOpen(false)}>
        <TouchableOpacity style={styles.langBackdrop} activeOpacity={1} onPress={() => setLangOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.langSheet, { backgroundColor: c.surface, borderColor: c.borderLit }]}>
              <ThemedText type="smallBold" colorType="textFaint" style={styles.langHeading}>
                {isAm ? "ቋንቋ" : "Language"}
              </ThemedText>
              {[
                { k: "am", l: "አማርኛ", amharic: true },
                { k: "en", l: "English", amharic: false },
                { k: "both", l: isAm ? "ሁለቱም" : "Both", amharic: isAm },
              ].map((o) => (
                <TouchableOpacity
                  key={o.k}
                  onPress={() => {
                    setViewMode(o.k as any);
                    setLangOpen(false);
                  }}
                  style={[styles.langRow, { borderColor: c.border }]}
                  accessibilityRole="button"
                >
                  <ThemedText
                    type="default"
                    isAmharic={o.amharic}
                    style={{ color: viewMode === o.k ? c.accent : c.text, flex: 1 }}
                  >
                    {o.l}
                  </ThemedText>
                  {viewMode === o.k ? <Icon name="check" size={16} color={c.accent} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Book & Chapter Selector Modal */}
      <Modal visible={selectorOpen} animationType="slide" transparent={false}>
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: c.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
            <ThemedText type="subtitle" colorType="text">
              {isAm ? "መጽሐፍ ይምረጡ" : "Select Book"}
            </ThemedText>
            <TouchableOpacity onPress={() => setSelectorOpen(false)} style={styles.actionBtn}>
              <Icon name="check" size={20} color={c.accent} />
            </TouchableOpacity>
          </View>

          <View style={[styles.testamentSelector, { borderBottomColor: c.border }]}>
            <TouchableOpacity
              onPress={() => {
                setActiveTestament("OT");
                setExpandedBookId(null);
              }}
              style={[
                styles.testamentTab,
                activeTestament === "OT" && { borderBottomColor: c.accent, borderBottomWidth: 2 }
              ]}
            >
              <ThemedText
                type="smallBold"
                style={{
                  color: activeTestament === "OT" ? c.accent : c.textSoft,
                  fontSize: 13,
                  paddingVertical: 10,
                }}
              >
                {isAm ? "ብሉይ ኪዳን" : "Old Testament"}
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setActiveTestament("NT");
                setExpandedBookId(null);
              }}
              style={[
                styles.testamentTab,
                activeTestament === "NT" && { borderBottomColor: c.accent, borderBottomWidth: 2 }
              ]}
            >
              <ThemedText
                type="smallBold"
                style={{
                  color: activeTestament === "NT" ? c.accent : c.textSoft,
                  fontSize: 13,
                  paddingVertical: 10,
                }}
              >
                {isAm ? "አዲስ ኪዳን" : "New Testament"}
              </ThemedText>
            </TouchableOpacity>
          </View>

          <FlatList
            data={books.filter(b => b.testament === activeTestament)}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.bookList}
            renderItem={({ item }) => {
              const isExpanded = expandedBookId === item.id;
              return (
                <View style={[styles.bookItem, { borderBottomColor: c.border }]}>
                  <TouchableOpacity
                    onPress={() => setExpandedBookId(isExpanded ? null : item.id)}
                    style={styles.bookItemHeader}
                  >
                    <ThemedText type="subtitle" colorType="text">
                      {isAm ? item.name_am : item.name_en}
                    </ThemedText>
                    <Icon name={isExpanded ? "down" : "chev"} size={14} color={c.textSoft} />
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.chaptersGrid}>
                      {Array.from({ length: item.chapters }, (_, i) => i + 1).map((ch) => (
                        <TouchableOpacity
                          key={ch}
                          onPress={() => {
                            setCurrentBook(item);
                            setCurrentChapter(ch);
                            setSelectorOpen(false);
                            setExpandedBookId(null);
                          }}
                          style={[
                            styles.chapterCell,
                            { borderColor: c.border, backgroundColor: c.surface },
                            currentBook?.id === item.id && currentChapter === ch
                              ? { backgroundColor: c.accent, borderColor: c.accent }
                              : null,
                          ]}
                        >
                          <ThemedText
                            type="smallBold"
                            style={{
                              color:
                                currentBook?.id === item.id && currentChapter === ch
                                  ? c.bg
                                  : c.text,
                            }}
                          >
                            {ch}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            }}
          />
        </SafeAreaView>
      </Modal>

      {/* Search Modal */}
      <Modal visible={searchOpen} animationType="fade" transparent={false}>
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: c.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
            <View style={[styles.searchBarContainer, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Icon name="search" size={16} color={c.textFaint} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={isAm ? "ቃል ይፈልጉ..." : "Search verses..."}
                placeholderTextColor={c.textFaint}
                autoFocus={true}
                style={[styles.searchInput, { color: c.text }]}
              />
            </View>
            <TouchableOpacity
              onPress={() => {
                setSearchOpen(false);
                setSearchQuery("");
                setSearchResults([]);
              }}
              style={styles.closeSearchBtn}
            >
              <ThemedText type="smallBold" colorType="accent">
                {isAm ? "ዝጋ" : "Close"}
              </ThemedText>
            </TouchableOpacity>
          </View>

          <SectionBoundary name="Bible.Search">
            {searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                keyExtractor={(item, idx) => `${item.book}-${item.chapter}-${item.verse}-${idx}`}
                contentContainerStyle={styles.searchResultsContainer}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => handleSelectSearchResult(item)}
                    style={[styles.searchResultItem, { borderBottomColor: c.border }]}
                  >
                    <ThemedText type="smallBold" colorType="accent" style={{ marginBottom: 4 }}>
                      {isAm ? item.name_am : item.name_en} {item.chapter}:{item.verse}
                    </ThemedText>
                    <ThemedText type="small" colorType="text" style={{ lineHeight: 18 }}>
                      {item.text_am}
                    </ThemedText>
                    <ThemedText type="small" colorType="textSoft" style={{ fontStyle: "italic", marginTop: 2 }}>
                      {item.text_en}
                    </ThemedText>
                  </TouchableOpacity>
                )}
              />
            ) : (
              <View style={styles.searchEmptyContainer}>
                <Icon name="search" size={32} color={c.border} />
                <ThemedText type="default" colorType="textFaint" style={{ marginTop: 10 }}>
                  {searchQuery.trim()
                    ? (isAm ? "ምንም ውጤት አልተገኘም" : "No results found")
                    : (isAm ? "አማርኛ ወይም እንግሊዝኛ ቃላትን ያስገቡ" : "Search in Amharic or English")}
                </ThemedText>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerRef: { flex: 1, marginRight: 12 },
  langBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  langSheet: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: 18, paddingVertical: 10 },
  langHeading: { paddingVertical: 10 },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iconbtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  navIconBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versesContainer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120 },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: 12 },
  verseItem: { padding: 10, borderRadius: radius.md, width: '100%', marginBottom: 4 },
  vnumRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  vnum: { fontSize: 11, fontWeight: '700' },
  amText: { fontSize: 17, lineHeight: 34 },
  enText: { fontSize: 15.5, lineHeight: 24 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, gap: 10 },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  testamentSelector: { flexDirection: "row", borderBottomWidth: 1 },
  testamentTab: { flex: 1, alignItems: "center" },
  bookList: { paddingHorizontal: 16, paddingBottom: 30 },
  bookItem: { borderBottomWidth: 1, paddingVertical: 14 },
  bookItemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chaptersGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  chapterCell: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBarContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 10,
    marginRight: 10,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8, marginLeft: 8 },
  closeSearchBtn: { justifyContent: "center" },
  searchResultsContainer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30 },
  searchResultItem: { paddingVertical: 12, borderBottomWidth: 1 },
  searchEmptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  actionBtn: { padding: 6 },
});
