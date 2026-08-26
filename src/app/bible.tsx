import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { Cross } from "@/components/cross";
import { Icon } from "@/components/icon";
import { toGeezNumeral } from "@/lib/ethiopian";
import { radius, fonts, space } from "@/theme/tokens";
import { reportError } from "@/lib/errors";
import { BibleSkeleton } from "@/components/skeletons/bible-skeleton";
import { useSkeleton } from "@/lib/use-skeleton";
import { SectionBoundary } from "@/components/section-boundary";

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
  const { c, lang } = useApp();
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

  // View state
  const [viewMode, setViewMode] = useState<"am" | "en" | "both">("am");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [expandedBookId, setExpandedBookId] = useState<number | null>(null);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VerseResult[]>([]);

  // Selection state (clicked verse)
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);
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
    if (!currentBook || selectedVerse === null) return;

    try {
      const localDb = await getLocalDb();
      const id = `${currentBook.id}-${currentChapter}-${selectedVerse}`;
      await runTransactionExclusive(localDb, async (txn) => {
        if (color) {
          await txn.runAsync(
            "INSERT OR REPLACE INTO highlights (id, book, chapter, verse, color, note, updated_at, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [id, currentBook.id, currentChapter, selectedVerse, color, null, Date.now(), 0]
          );
        } else {
          await txn.runAsync("DELETE FROM highlights WHERE id = ?", [id]);
        }
      });

      if (color) {
        setHighlights(prev => ({ ...prev, [selectedVerse]: color }));
      } else {
        setHighlights(prev => {
          const copy = { ...prev };
          delete copy[selectedVerse];
          return copy;
        });
      }
      setSelectedVerse(null);
    } catch (err) {
      reportError(err, "BibleScreen.handleHighlight", lang);
    }
  };

  // Handle Bookmarks
  const toggleBookmark = async () => {
    if (!currentBook || selectedVerse === null) return;

    const isBookmarked = bookmarks.has(selectedVerse);
    const id = `${currentBook.id}-${currentChapter}-${selectedVerse}`;

    try {
      const localDb = await getLocalDb();
      await runTransactionExclusive(localDb, async (txn) => {
        if (isBookmarked) {
          await txn.runAsync("DELETE FROM bookmarks WHERE id = ?", [id]);
        } else {
          await txn.runAsync(
            "INSERT OR REPLACE INTO bookmarks (id, book, chapter, verse, updated_at, synced) VALUES (?, ?, ?, ?, ?, ?)",
            [id, currentBook.id, currentChapter, selectedVerse, Date.now(), 0]
          );
        }
      });

      if (isBookmarked) {
        setBookmarks(prev => {
          const copy = new Set(prev);
          copy.delete(selectedVerse);
          return copy;
        });
      } else {
        setBookmarks(prev => {
          const copy = new Set(prev);
          copy.add(selectedVerse);
          return copy;
        });
      }
      setSelectedVerse(null);
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
        setSelectedVerse(result.verse);
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
          <TouchableOpacity
            onPress={() => setSelectorOpen(true)}
            style={styles.bookSelectorBtn}
            activeOpacity={0.7}
          >
            <ThemedText type="subtitle" colorType="text" style={{ marginRight: 6 }}>
              {currentBook ? (isAm ? currentBook.name_am : currentBook.name_en) : ""} {currentChapter}
            </ThemedText>
            <Icon name="chevron" size={14} color={c.textSoft} />
          </TouchableOpacity>

          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => setSearchOpen(true)}
              style={[styles.iconbtn, { borderColor: c.border, backgroundColor: c.surface }]}
            >
              <Icon name="search" size={17} color={c.textSoft} />
            </TouchableOpacity>
          </View>
        </View>
      </SectionBoundary>

      {/* Reader Layout Scroll */}
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.versesContainer}>
        {/* Offline Badge Row */}
        <SectionBoundary name="Bible.OfflineBadge">
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            <View style={[styles.chip, { borderColor: c.accentDim, backgroundColor: c.accentGlow }]}>
              <Cross size={10} color={c.accent} />
              <ThemedText type="smallBold" colorType="accent" style={{ marginLeft: 4 }}>
                ያለ ኢንተርኔት
              </ThemedText>
            </View>
            <View style={[styles.chip, { borderColor: c.border, backgroundColor: c.surface }]}>
              <ThemedText type="small" colorType="textFaint">
                0 MB · bundled
              </ThemedText>
            </View>
          </View>
        </SectionBoundary>

        {/* View mode segment switcher */}
        <View style={[styles.seg, { backgroundColor: c.surface, borderColor: c.border }]}>
          {[
            { k: "am", l: "አማርኛ", isAm: true },
            { k: "en", l: "English", isAm: false },
            { k: "both", l: "ሁለቱም", isAm: true },
          ].map((o) => (
            <TouchableOpacity
              key={o.k}
              onPress={() => setViewMode(o.k as any)}
              style={[
                styles.segBtn,
                viewMode === o.k && { backgroundColor: c.accent },
              ]}
            >
              <ThemedText
                type="smallBold"
                isAmharic={o.isAm}
                style={{
                  color: viewMode === o.k ? c.bg : c.textSoft,
                }}
              >
                {o.l}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chapter Title & Navigation Row */}
        <View style={[styles.chapterRow, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <ThemedText type="subtitle" colorType="text" isAmharic={true}>
              {currentBook ? (isAm ? currentBook.name_am : currentBook.name_en) : ""} {toGeezNumeral(currentChapter)}
            </ThemedText>
            <ThemedText type="small" colorType="textFaint" style={{ marginTop: 2 }}>
              {currentBook?.name_en} {currentChapter} · {currentBook?.testament === 'OT' ? 'ብሉይ ኪዳን' : 'አዲስ ኪዳን'}
            </ThemedText>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity
              onPress={prevChapter}
              style={[styles.navIconBtn, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}
            >
              <View style={{ transform: [{ rotate: '180deg' }] }}>
                <Icon name="chev" size={14} color={c.textSoft} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={nextChapter}
              style={[styles.navIconBtn, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}
            >
              <Icon name="chev" size={14} color={c.textSoft} />
            </TouchableOpacity>
          </View>
        </View>

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
                  const isSelected = selectedVerse === v.verse;
                  const highlightColor = highlights[v.verse];
                  const isBookmarked = bookmarks.has(v.verse);

                  return (
                    <TouchableOpacity
                      key={v.verse}
                      activeOpacity={0.7}
                      onPress={() => setSelectedVerse(isSelected ? null : v.verse)}
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

      {/* Action Sheet Overlay when Verse Selected */}
      {selectedVerse !== null && (
        <SectionBoundary name="Bible.VerseActions" fallback={null}>
          <View style={[styles.actionPanel, { backgroundColor: c.surface, borderTopColor: c.borderLit }]}>
            <View style={styles.actionPanelHeader}>
              <ThemedText type="smallBold" colorType="textFaint">
                {isAm ? `ቁጥር ${selectedVerse} ምልክት` : `Verse ${selectedVerse} Actions`}
              </ThemedText>
              <TouchableOpacity onPress={() => setSelectedVerse(null)}>
                <Icon name="check" size={16} color={c.accent} />
              </TouchableOpacity>
            </View>

            <View style={styles.actionRow}>
              <View style={styles.highlightSelector}>
                {highlightColors.map((col) => (
                  <TouchableOpacity
                    key={col.name}
                    onPress={() => handleHighlight(col.hex)}
                    style={[styles.colorBubble, { backgroundColor: col.hex }]}
                  />
                ))}
                {highlights[selectedVerse] && (
                  <TouchableOpacity
                    onPress={() => handleHighlight(null)}
                    style={[styles.colorBubbleClear, { borderColor: c.border }]}
                  >
                    <Icon name="check" size={12} color={c.textSoft} />
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                onPress={toggleBookmark}
                style={[styles.bookmarkBtn, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}
              >
                <Icon
                  name="bookmark"
                  size={14}
                  color={bookmarks.has(selectedVerse) ? c.accent : c.textSoft}
                />
                <ThemedText type="smallBold" colorType="textSoft" style={{ marginLeft: 6 }}>
                  {bookmarks.has(selectedVerse)
                    ? (isAm ? "ዕልባት አጥፋ" : "Unbookmark")
                    : (isAm ? "ዕልባት አድርግ" : "Bookmark")}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </SectionBoundary>
      )}
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
  bookSelectorBtn: { flexDirection: "row", alignItems: "center" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconbtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  seg: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
    borderWidth: 1,
    marginBottom: 16,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
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
  actionPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    padding: 16,
    paddingBottom: 24,
  },
  actionPanelHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  highlightSelector: { flexDirection: 'row', gap: 8 },
  colorBubble: { width: 28, height: 28, borderRadius: 14 },
  colorBubbleClear: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionBtn: { padding: 6 },
  bookmarkBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: radius.pill },
});
