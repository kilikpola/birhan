import * as SQLite from 'expo-sqlite';

/**
 * Verse of the day — resolved from the BUNDLED bible_v3.db. No backend,
 * no devotion text to license or write. A curated list of references;
 * the day picks one deterministically so everyone sees the same verse
 * on the same day, and it works fully offline.
 */

const VERSES: [number, number, number][] = [
  [1, 1, 3],     // Genesis 1:3  — light
  [19, 23, 1],   // Psalm 23:1
  [43, 3, 16],   // John 3:16
  [50, 4, 4],    // Philippians 4:4  — rejoice
  [45, 8, 28],   // Romans 8:28
  [23, 40, 31],  // Isaiah 40:31
  [40, 11, 28],  // Matthew 11:28
  [20, 3, 5],    // Proverbs 3:5
  [19, 46, 1],   // Psalm 46:1
  [58, 11, 1],   // Hebrews 11:1
  [50, 4, 13],   // Philippians 4:13
  [24, 29, 11],  // Jeremiah 29:11
];

export type VerseOfDay = {
  book: number; chapter: number; verse: number;
  ref_am: string; ref_en: string;
  text_am: string; text_en: string;
};

// stable day index (days since epoch) → same verse all day, rotates daily.
// Exported so the daily-verse notification schedules the SAME verse the Today
// screen will show on that date.
export function verseIndexForMs(ms: number): number {
  const days = Math.floor(ms / 86_400_000);
  return ((days % VERSES.length) + VERSES.length) % VERSES.length;
}

async function resolveVerse(
  bibleDb: SQLite.SQLiteDatabase,
  [book, chapter, verse]: [number, number, number],
): Promise<VerseOfDay | null> {
  const row = await bibleDb.getFirstAsync<any>(
    `SELECT v.text_am, v.text_en, b.name_am, b.name_en
     FROM verses v JOIN books b ON b.id = v.book
     WHERE v.book = ? AND v.chapter = ? AND v.verse = ?`,
    [book, chapter, verse],
  );
  if (!row) return null;
  return {
    book, chapter, verse,
    ref_am: `${row.name_am} ${chapter}:${verse}`,
    ref_en: `${row.name_en} ${chapter}:${verse}`,
    text_am: row.text_am,
    text_en: row.text_en,
  };
}

export async function getVerseOfDay(
  bibleDb: SQLite.SQLiteDatabase,
): Promise<VerseOfDay | null> {
  return resolveVerse(bibleDb, VERSES[verseIndexForMs(Date.now())]);
}

/** The verse for a specific calendar moment — used to schedule ahead. */
export async function getVerseForDate(
  bibleDb: SQLite.SQLiteDatabase,
  date: Date,
): Promise<VerseOfDay | null> {
  return resolveVerse(bibleDb, VERSES[verseIndexForMs(date.getTime())]);
}
