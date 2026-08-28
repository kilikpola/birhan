import { Modal, View, TouchableOpacity, Share, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/icon';
import { t, type Lang } from '@/i18n';
import { toGeezNumeral } from '@/lib/ethiopian';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { reportError, notifyToast } from '@/lib/errors';
import type { StudyVerseRef } from './types';

export type StudyPanel = 'crossrefs' | 'commentary' | 'wordstudy';

function verseCitation(v: StudyVerseRef, isAm: boolean): { text: string; citation: string } {
  const text = isAm ? v.textAm : v.textEn;
  const bookName = isAm ? v.bookNameAm : v.bookNameEn;
  const verseLabel = isAm ? toGeezNumeral(v.verse) : String(v.verse);
  const chapterLabel = isAm ? toGeezNumeral(v.chapter) : String(v.chapter);
  return { text, citation: `${bookName} ${chapterLabel}:${verseLabel}` };
}

export type HighlightSwatch = { name: string; hex: string };

export function VerseActionSheet({
  visible,
  verseRef,
  colors,
  lang,
  onClose,
  onOpenPanel,
  highlightColors,
  activeHighlight,
  onHighlight,
  isBookmarked,
  onToggleBookmark,
}: {
  visible: boolean;
  verseRef: StudyVerseRef | null;
  colors: Palette;
  lang: Lang;
  onClose: () => void;
  onOpenPanel: (panel: StudyPanel) => void;
  /**
   * Highlighting and bookmarking live here because this sheet is now reached
   * by a single tap. It used to be a long-press, with tap opening a separate
   * highlight/bookmark bar; folding both into one sheet is what lets the tap
   * do everything without the two surfaces fighting over the same gesture.
   * Optional so the sheet still renders if a caller does not offer them.
   */
  highlightColors?: HighlightSwatch[];
  activeHighlight?: string | null;
  onHighlight?: (hex: string | null) => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
}) {
  const isAm = lang === 'am';

  const handleCopy = async () => {
    if (!verseRef) return;
    const { text, citation } = verseCitation(verseRef, isAm);
    try {
      await Clipboard.setStringAsync(`${text} — ${citation}`);
      notifyToast(t(lang, 'copiedToClipboard'), 'success');
    } catch (err) {
      reportError(err, 'VerseActionSheet.copy', lang);
    }
    onClose();
  };

  const handleShare = async () => {
    if (!verseRef) return;
    const { text, citation } = verseCitation(verseRef, isAm);
    try {
      await Share.share({ message: `${text} — ${citation}` });
    } catch (err) {
      reportError(err, 'VerseActionSheet.share', lang);
    }
    onClose();
  };

  const rows: { key: StudyPanel | 'copy' | 'share'; icon: IconName; label: string; onPress: () => void }[] = [
    { key: 'crossrefs', icon: 'link', label: t(lang, 'actionCrossRefs'), onPress: () => onOpenPanel('crossrefs') },
    { key: 'commentary', icon: 'quote', label: t(lang, 'actionCommentary'), onPress: () => onOpenPanel('commentary') },
    { key: 'wordstudy', icon: 'tag', label: t(lang, 'actionWordStudy'), onPress: () => onOpenPanel('wordstudy') },
    { key: 'copy', icon: 'copy', label: t(lang, 'actionCopy'), onPress: handleCopy },
    { key: 'share', icon: 'share', label: t(lang, 'actionShare'), onPress: handleShare },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.borderLit }]}>
            <View style={styles.header}>
              <ThemedText type="smallBold" colorType="textFaint">
                {verseRef
                  ? t(lang, 'verseActionsTitle').replace('%1', isAm ? toGeezNumeral(verseRef.verse) : String(verseRef.verse))
                  : ''}
              </ThemedText>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Icon name="check" size={16} color={colors.accent} />
              </TouchableOpacity>
            </View>

            {highlightColors && onHighlight ? (
              <View style={[styles.swatchRow, { borderColor: colors.border }]}>
                {highlightColors.map((col) => (
                  <TouchableOpacity
                    key={col.name}
                    accessibilityRole="button"
                    accessibilityLabel={col.name}
                    onPress={() => onHighlight(col.hex)}
                    style={[
                      styles.swatch,
                      { backgroundColor: col.hex },
                      activeHighlight === col.hex && { borderColor: colors.accent, borderWidth: 2 },
                    ]}
                  />
                ))}
                {activeHighlight ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => onHighlight(null)}
                    style={[styles.swatch, styles.swatchClear, { borderColor: colors.border }]}
                  >
                    <Icon name="check" size={12} color={colors.textSoft} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {onToggleBookmark ? (
              <TouchableOpacity
                onPress={onToggleBookmark}
                activeOpacity={0.7}
                style={[styles.row, { borderColor: colors.border }]}
              >
                <Icon name="bookmark" size={18} color={colors.accent} />
                <ThemedText type="default" colorType="text" isAmharic={isAm} style={styles.rowLabel}>
                  {t(lang, isBookmarked ? 'actionUnbookmark' : 'actionBookmark')}
                </ThemedText>
              </TouchableOpacity>
            ) : null}

            {rows.map((row) => (
              <TouchableOpacity
                key={row.key}
                onPress={row.onPress}
                activeOpacity={0.7}
                style={[styles.row, { borderColor: colors.border }]}
              >
                <Icon name={row.icon} size={18} color={colors.accent} />
                <ThemedText type="default" colorType="text" isAmharic={isAm} style={styles.rowLabel}>
                  {row.label}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </SafeAreaView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
    paddingBottom: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: 15,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  swatchClear: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
