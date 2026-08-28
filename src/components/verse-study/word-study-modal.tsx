import { useEffect, useState } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/icon';
import { t, type Lang } from '@/i18n';
import { toGeezNumeral } from '@/lib/ethiopian';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { reportError } from '@/lib/errors';
import {
  getWordTags,
  getStrongsEntry,
  getOtherVersesForStrongsId,
  type WordTag,
  type StrongsEntry,
  type OtherVerseRef,
} from '@/lib/verseStudy';
import type { NavigateTarget, StudyBook, StudyVerseRef } from './types';

export function WordStudyModal({
  visible,
  verseRef,
  books,
  lang,
  colors,
  onClose,
  onNavigate,
}: {
  visible: boolean;
  verseRef: StudyVerseRef | null;
  books: StudyBook[];
  lang: Lang;
  colors: Palette;
  onClose: () => void;
  onNavigate: (target: NavigateTarget) => void;
}) {
  const isAm = lang === 'am';
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<WordTag[]>([]);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [entry, setEntry] = useState<StrongsEntry | null>(null);
  const [otherVerses, setOtherVerses] = useState<{ refs: OtherVerseRef[]; truncated: boolean }>({ refs: [], truncated: false });
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!visible || !verseRef) return;
    let active = true;
    setLoading(true);
    setSelectedIndex(null);
    setEntry(null);
    getWordTags(verseRef.book, verseRef.chapter, verseRef.verse)
      .then((r) => {
        if (active) setTags(r);
      })
      .catch((err) => {
        reportError(err, 'WordStudyModal.load', lang, false);
        if (active) setTags([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible, verseRef, lang]);

  const handleTapWord = async (tag: WordTag) => {
    if (!tag.strongsId) return;
    setSelectedIndex(tag.wordIndex);
    setDetailLoading(true);
    try {
      const [e, ov] = await Promise.all([
        getStrongsEntry(tag.strongsId),
        getOtherVersesForStrongsId(tag.strongsId),
      ]);
      setEntry(e);
      setOtherVerses(ov);
    } catch (err) {
      reportError(err, 'WordStudyModal.detail', lang, false);
      setEntry(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const bookName = (id: number) => {
    const b = books.find((bk) => bk.id === id);
    return b ? b.name_en : '';
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={[styles.outer, { backgroundColor: colors.bg }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <View style={{ transform: [{ rotate: '180deg' }] }}>
              <Icon name="chev" size={18} color={colors.textSoft} />
            </View>
          </TouchableOpacity>
          <ThemedText type="subtitle" colorType="text">{t(lang, 'wordStudyTitle')}</ThemedText>
          <View style={{ width: 18 }} />
        </View>

        <ThemedText type="small" colorType="textFaint" style={styles.notice}>
          {t(lang, 'wordStudyEnglishOnly')}
        </ThemedText>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : tags.length === 0 ? (
          <ThemedText type="default" colorType="textFaint" style={styles.empty}>
            {t(lang, 'wordStudyEmpty')}
          </ThemedText>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={[styles.verseCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.wordWrap}>
                {tags.map((tag) => (
                  <TouchableOpacity
                    key={tag.wordIndex}
                    onPress={() => handleTapWord(tag)}
                    disabled={!tag.strongsId}
                    activeOpacity={tag.strongsId ? 0.6 : 1}
                  >
                    <ThemedText
                      type="default"
                      isAmharic={false}
                      style={[
                        styles.word,
                        { color: tag.strongsId ? colors.accent : colors.text },
                        tag.strongsId && styles.wordTappable,
                        selectedIndex === tag.wordIndex && { backgroundColor: colors.accentGlow, borderRadius: radius.sm },
                      ]}
                    >
                      {tag.word}{' '}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {selectedIndex !== null && (
              <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.borderLit }]}>
                {detailLoading ? (
                  <ActivityIndicator color={colors.accent} />
                ) : !entry ? null : (
                  <>
                    <View style={styles.detailHeaderRow}>
                      <ThemedText type="title" colorType="accent">{entry.id}</ThemedText>
                      {!!entry.lemma && (
                        <ThemedText type="subtitle" colorType="textSoft" style={{ marginLeft: space.sm }}>
                          {entry.lemma}
                        </ThemedText>
                      )}
                    </View>

                    {!!entry.translit && (
                      <View style={styles.field}>
                        <ThemedText type="smallBold" colorType="textFaint">{t(lang, 'wordStudyTransliteration')}</ThemedText>
                        <ThemedText type="default" colorType="text">{entry.translit}</ThemedText>
                      </View>
                    )}

                    <View style={styles.field}>
                      <ThemedText type="smallBold" colorType="textFaint">{t(lang, 'wordStudyDefinition')}</ThemedText>
                      <ThemedText type="default" colorType="text" style={{ lineHeight: 22 }}>{entry.definitionEn}</ThemedText>
                    </View>

                    {!!entry.kjvUsage && (
                      <View style={styles.field}>
                        <ThemedText type="smallBold" colorType="textFaint">{t(lang, 'wordStudyUsage')}</ThemedText>
                        <ThemedText type="default" colorType="text">{entry.kjvUsage}</ThemedText>
                      </View>
                    )}

                    <View style={[styles.field, { marginTop: space.sm }]}>
                      <ThemedText type="smallBold" colorType="textFaint" style={{ marginBottom: 6 }}>
                        {t(lang, 'wordStudyOtherVerses')}
                      </ThemedText>
                      {otherVerses.refs.map((r, i) => (
                        <TouchableOpacity
                          key={`${r.book}-${r.chapter}-${r.verse}-${i}`}
                          onPress={() => {
                            onNavigate(r);
                            onClose();
                          }}
                          style={styles.otherVerseRow}
                        >
                          <ThemedText type="link" colorType="lapis">
                            {bookName(r.book)} {r.chapter}:{r.verse}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                      {otherVerses.truncated && (
                        <ThemedText type="small" colorType="textFaint" style={{ marginTop: 4 }}>
                          {t(lang, 'wordStudyMoreResults')}
                        </ThemedText>
                      )}
                    </View>
                  </>
                )}
              </View>
            )}
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
  notice: { paddingHorizontal: space.lg, paddingTop: space.sm, lineHeight: 18 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  scroll: { padding: space.lg, paddingBottom: 40 },
  verseCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  wordWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  word: { fontSize: 17, lineHeight: 30 },
  wordTappable: { textDecorationLine: 'underline' },
  detailCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
  },
  detailHeaderRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: space.sm },
  field: { marginTop: space.sm },
  otherVerseRow: { paddingVertical: 4 },
});
