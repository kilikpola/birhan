import type * as SQLite from 'expo-sqlite';
import { type Lang } from '@/i18n';
import type { Palette } from '@/theme/tokens';
import { VerseActionSheet, type StudyPanel, type HighlightSwatch } from './verse-action-sheet';
import { CrossReferencesModal } from './cross-references-modal';
import { CommentaryModal } from './commentary-modal';
import { WordStudyModal } from './word-study-modal';
import type { NavigateTarget, StudyBook, StudyVerseRef } from './types';

export type { StudyPanel } from './verse-action-sheet';
export type { StudyBook, StudyVerseRef, NavigateTarget } from './types';

/**
 * Owns all four verse-study surfaces reached by tapping a verse: the action
 * list, and the cross-reference / commentary / word-study detail sheets.
 * Exactly one is visible at a time, selected by `panel`.
 */
export function VerseStudySheets({
  verseRef,
  panel,
  bibleDb,
  books,
  lang,
  colors,
  onClose,
  onOpenPanel,
  onNavigate,
  highlightColors,
  activeHighlight,
  onHighlight,
  isBookmarked,
  onToggleBookmark,
}: {
  verseRef: StudyVerseRef | null;
  panel: 'actions' | StudyPanel | null;
  bibleDb: SQLite.SQLiteDatabase | null;
  books: StudyBook[];
  lang: Lang;
  colors: Palette;
  onClose: () => void;
  onOpenPanel: (panel: StudyPanel) => void;
  onNavigate: (target: NavigateTarget) => void;
  highlightColors?: HighlightSwatch[];
  activeHighlight?: string | null;
  onHighlight?: (hex: string | null) => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
}) {
  return (
    <>
      <VerseActionSheet
        visible={panel === 'actions'}
        verseRef={verseRef}
        colors={colors}
        lang={lang}
        onClose={onClose}
        onOpenPanel={onOpenPanel}
        highlightColors={highlightColors}
        activeHighlight={activeHighlight}
        onHighlight={onHighlight}
        isBookmarked={isBookmarked}
        onToggleBookmark={onToggleBookmark}
      />
      <CrossReferencesModal
        visible={panel === 'crossrefs'}
        verseRef={verseRef}
        bibleDb={bibleDb}
        books={books}
        lang={lang}
        colors={colors}
        onClose={onClose}
        onNavigate={onNavigate}
      />
      <CommentaryModal
        visible={panel === 'commentary'}
        verseRef={verseRef}
        lang={lang}
        colors={colors}
        onClose={onClose}
      />
      <WordStudyModal
        visible={panel === 'wordstudy'}
        verseRef={verseRef}
        books={books}
        lang={lang}
        colors={colors}
        onClose={onClose}
        onNavigate={onNavigate}
      />
    </>
  );
}
