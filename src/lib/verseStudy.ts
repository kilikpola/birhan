import * as SQLite from 'expo-sqlite';
import { getStrongsDb, getCrossrefsDb, getCommentaryDb, getPatristicDb } from './verseStudyDb';

/* ---------- Cross-references ---------- */

export type CrossRef = {
  toBook: number;
  toChapter: number;
  toVerse: number;
  toVerseEnd: number;
  votes: number;
  /** Verse text in the caller's reading language; empty if the target verse is blank. */
  text: string;
};

/** xrefs ordered by votes desc (idx_xrefs_from covers this exactly), with each
 * target's starting-verse text pulled from bible_v3.db in the given language. */
export async function getCrossReferences(
  bibleDb: SQLite.SQLiteDatabase,
  book: number,
  chapter: number,
  verse: number,
  lang: 'am' | 'en',
): Promise<CrossRef[]> {
  const crossDb = await getCrossrefsDb();
  const rows = await crossDb.getAllAsync<{
    to_book: number; to_chapter: number; to_verse: number; to_verse_end: number; votes: number;
  }>(
    'SELECT to_book, to_chapter, to_verse, to_verse_end, votes FROM xrefs WHERE from_book = ? AND from_chapter = ? AND from_verse = ? ORDER BY votes DESC',
    [book, chapter, verse],
  );

  const results: CrossRef[] = [];
  for (const r of rows) {
    const v = await bibleDb.getFirstAsync<{ text_am: string; text_en: string }>(
      'SELECT text_am, text_en FROM verses WHERE book = ? AND chapter = ? AND verse = ?',
      [r.to_book, r.to_chapter, r.to_verse],
    );
    results.push({
      toBook: r.to_book,
      toChapter: r.to_chapter,
      toVerse: r.to_verse,
      toVerseEnd: r.to_verse_end,
      votes: r.votes,
      text: v ? (lang === 'am' ? v.text_am : v.text_en) : '',
    });
  }
  return results;
}

/* ---------- Commentary ---------- */

export type CommentaryEntry = {
  id: number;
  label: string;
  body: string;
  source: string;
};

/** commentaries where the verse falls within [verse_start, verse_end] (idx_comm_ref). */
export async function getCommentary(book: number, chapter: number, verse: number): Promise<CommentaryEntry[]> {
  const db = await getCommentaryDb();
  return db.getAllAsync<CommentaryEntry>(
    'SELECT id, label, body, source FROM commentaries WHERE book = ? AND chapter = ? AND verse_start <= ? AND verse_end >= ? ORDER BY verse_start ASC',
    [book, chapter, verse, verse],
  );
}

export type FatherEntry = {
  id: number;
  authorId: number;
  authorName: string;
  authorYear: number | null;
  sourceTitle: string;
  body: string;
};

/**
 * Patristic entries for the verse, grouped by author by the caller.
 * Returns null when the patristic database hasn't been downloaded yet —
 * distinct from an empty array, which means "downloaded, nothing for this verse."
 */
export async function getPatristicEntries(
  book: number,
  chapter: number,
  verse: number,
): Promise<FatherEntry[] | null> {
  const db = await getPatristicDb();
  if (!db) return null;

  // Almost every row is single-chapter (chapter_start = chapter_end), but a
  // handful genuinely span chapters, so the target (chapter, verse) is
  // compared against the full (chapter_start, verse_start)–(chapter_end,
  // verse_end) range rather than assuming chapter_start = chapter_end = chapter.
  const rows = await db.getAllAsync<{
    id: number; author_id: number; source_title: string; body: string;
    author_name: string; author_year: number | null;
  }>(
    `SELECT f.id, f.author_id, f.source_title, f.body, a.name AS author_name, a.year AS author_year
     FROM fathers f JOIN authors a ON a.id = f.author_id
     WHERE f.book = ?
       AND (f.chapter_start < ? OR (f.chapter_start = ? AND f.verse_start <= ?))
       AND (f.chapter_end > ? OR (f.chapter_end = ? AND f.verse_end >= ?))
     ORDER BY a.name ASC, f.id ASC`,
    [book, chapter, chapter, verse, chapter, chapter, verse],
  );

  return rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    authorName: r.author_name,
    authorYear: r.author_year,
    sourceTitle: r.source_title,
    body: r.body,
  }));
}

/* ---------- Word study ---------- */

export type WordTag = {
  wordIndex: number;
  word: string;
  strongsId: string | null;
};

/** Word-by-word Strong's tags for one verse, in reading order. The KJV text
 * rendered for word study is reconstructed from these tags (not bible_v3.db's
 * text_en) so every rendered token is guaranteed to map to exactly one tag —
 * see STRONGS_NOTES.md on why the two texts can't be assumed to align. */
export async function getWordTags(book: number, chapter: number, verse: number): Promise<WordTag[]> {
  const db = await getStrongsDb();
  const rows = await db.getAllAsync<{ word_index: number; word: string; strongs_id: string | null }>(
    'SELECT word_index, word, strongs_id FROM kjv_tags WHERE book = ? AND chapter = ? AND verse = ? ORDER BY word_index ASC',
    [book, chapter, verse],
  );
  return rows.map((r) => ({ wordIndex: r.word_index, word: r.word, strongsId: r.strongs_id }));
}

export type StrongsEntry = {
  id: string;
  lang: string;
  lemma: string | null;
  translit: string | null;
  definitionEn: string;
  kjvUsage: string | null;
};

export async function getStrongsEntry(id: string): Promise<StrongsEntry | null> {
  const db = await getStrongsDb();
  const row = await db.getFirstAsync<{
    id: string; lang: string; lemma: string | null; translit: string | null;
    definition_en: string; kjv_usage: string | null;
  }>(
    'SELECT id, lang, lemma, translit, definition_en, kjv_usage FROM strongs WHERE id = ?',
    [id],
  );
  if (!row) return null;
  return {
    id: row.id,
    lang: row.lang,
    lemma: row.lemma,
    translit: row.translit,
    definitionEn: row.definition_en,
    kjvUsage: row.kjv_usage,
  };
}

export type OtherVerseRef = { book: number; chapter: number; verse: number };

/** Other verses tagged with this Strong's number, capped so a common word
 * (e.g. G2532 "and") doesn't return thousands of rows. */
export async function getOtherVersesForStrongsId(
  strongsId: string,
  limit = 50,
): Promise<{ refs: OtherVerseRef[]; truncated: boolean }> {
  const db = await getStrongsDb();
  const rows = await db.getAllAsync<{ book: number; chapter: number; verse: number }>(
    'SELECT DISTINCT book, chapter, verse FROM kjv_tags WHERE strongs_id = ? ORDER BY book, chapter, verse LIMIT ?',
    [strongsId, limit + 1],
  );
  const truncated = rows.length > limit;
  return {
    refs: rows.slice(0, limit).map((r) => ({ book: r.book, chapter: r.chapter, verse: r.verse })),
    truncated,
  };
}
