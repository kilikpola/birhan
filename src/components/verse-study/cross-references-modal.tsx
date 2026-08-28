import { useEffect, useState } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type * as SQLite from 'expo-sqlite';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/icon';
import { t, type Lang } from '@/i18n';
import { toGeezNumeral } from '@/lib/ethiopian';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { reportError } from '@/lib/errors';
import { getCrossReferences, type CrossRef } from '@/lib/verseStudy';
import type { NavigateTarget, StudyBook, StudyVerseRef } from './types';

function refLabel(book: StudyBook | undefined, chapter: number, verse: number, verseEnd: number, isAm: boolean): string {
  if (!book) return '';
  const name = isAm ? book.name_am : book.name_en;
  const ch = isAm ? toGeezNumeral(chapter) : String(chapter);
  const v1 = isAm ? toGeezNumeral(verse) : String(verse);
  if (verseEnd > verse) {
    const v2 = isAm ? toGeezNumeral(verseEnd) : String(verseEnd);
    return `${name} ${ch}:${v1}-${v2}`;
  }
  return `${name} ${ch}:${v1}`;
}

export function CrossReferencesModal({
  visible,
  verseRef,
  bibleDb,
  books,
  lang,
  colors,
  onClose,
  onNavigate,
}: {
  visible: boolean;
  verseRef: StudyVerseRef | null;
  bibleDb: SQLite.SQLiteDatabase | null;
  books: StudyBook[];
  lang: Lang;
  colors: Palette;
  onClose: () => void;
  onNavigate: (target: NavigateTarget) => void;
}) {
  const isAm = lang === 'am';
  const [loading, setLoading] = useState(true);
  const [refs, setRefs] = useState<CrossRef[]>([]);

  useEffect(() => {
    if (!visible || !verseRef || !bibleDb) return;
    let active = true;
    setLoading(true);
    getCrossReferences(bibleDb, verseRef.book, verseRef.chapter, verseRef.verse, lang)
      .then((r) => {
        if (active) setRefs(r);
      })
      .catch((err) => {
        reportError(err, 'CrossReferencesModal.load', lang, false);
        if (active) setRefs([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible, verseRef, bibleDb, lang]);

  const bookById = (id: number) => books.find((b) => b.id === id);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={[styles.outer, { backgroundColor: colors.bg }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <View style={{ transform: [{ rotate: '180deg' }] }}>
              <Icon name="chev" size={18} color={colors.textSoft} />
            </View>
          </TouchableOpacity>
          <ThemedText type="subtitle" colorType="text">{t(lang, 'crossRefsTitle')}</ThemedText>
          <View style={{ width: 18 }} />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : refs.length === 0 ? (
          <ThemedText type="default" colorType="textFaint" style={styles.empty}>
            {t(lang, 'crossRefsEmpty')}
          </ThemedText>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {refs.map((r, i) => (
              <TouchableOpacity
                key={`${r.toBook}-${r.toChapter}-${r.toVerse}-${i}`}
                onPress={() => {
                  onNavigate({ book: r.toBook, chapter: r.toChapter, verse: r.toVerse });
                  onClose();
                }}
                activeOpacity={0.7}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <ThemedText type="smallBold" colorType="accent">
                  {refLabel(bookById(r.toBook), r.toChapter, r.toVerse, r.toVerseEnd, isAm)}
                </ThemedText>
                {!!r.text && (
                  <ThemedText
                    type="small"
                    colorType="text"
                    isAmharic={isAm}
                    style={[styles.verseText, isAm && styles.verseTextAm]}
                    numberOfLines={3}
                  >
                    {r.text}
                  </ThemedText>
                )}
              </TouchableOpacity>
            ))}
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
  list: { padding: space.lg, gap: space.sm },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  verseText: { marginTop: 4, lineHeight: 20 },
  // Ge'ez glyphs are tall and dense — needs roughly double the leading a Latin
  // line at the same size would use (matches bible.tsx's amText ratio).
  verseTextAm: { fontSize: 13, lineHeight: 26 },
});
