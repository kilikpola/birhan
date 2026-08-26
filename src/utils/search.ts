import * as SQLite from "expo-sqlite";

/**
 * Normalizes Amharic text by folding homophone families to a base character form:
 * - H-family: [ሐኀኃሃኅኻ] -> ሀ
 * - S-family: [ሠ] -> ሰ
 * - A-family: [ዐዓ] -> አ
 * - TS-family: [ፀ] -> ጸ
 */
export function normalizeAmharic(text: string): string {
  if (!text) return "";
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // ሐ (U+1210 - U+1216) -> ሀ (U+1200 - U+1206)
    if (code >= 0x1210 && code <= 0x1216) {
      result += String.fromCharCode(code - 0x10);
    }
    // ሠ (U+1220 - U+1226) -> ሰ (U+1230 - U+1236)
    else if (code >= 0x1220 && code <= 0x1226) {
      result += String.fromCharCode(code + 0x10);
    }
    // ኀ (U+1280 - U+1286) -> ሀ (U+1200 - U+1206)
    else if (code >= 0x1280 && code <= 0x1286) {
      result += String.fromCharCode(code - 0x80);
    }
    // ዐ (U+12d0 - U+12d6) -> አ (U+12a0 - U+12a6)
    else if (code >= 0x12d0 && code <= 0x12d6) {
      result += String.fromCharCode(code - 0x30);
    }
    // ፀ (U+1340 - U+1346) -> ጸ (U+1338 - U+133e)
    else if (code >= 0x1340 && code <= 0x1346) {
      result += String.fromCharCode(code - 0x08);
    }
    else {
      result += text[i];
    }
  }
  return result;
}

/**
 * Detects if a text string contains Ge'ez/Ethiopic unicode characters.
 */
export function isEthiopic(text: string): boolean {
  return /[\u1200-\u137F]/.test(text);
}

export interface VerseResult {
  book: number;
  chapter: number;
  verse: number;
  text_am: string;
  text_en: string;
  name_am: string;
  name_en: string;
}

/**
 * Searches the Bible database using FTS5 based on the user query.
 * Detects language automatically, tokenizes, and performs prefix matching.
 */
export async function searchBible(
  db: SQLite.SQLiteDatabase,
  query: string
): Promise<VerseResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Strip FTS5 operators to prevent query parsing crashes
  const cleaned = trimmed.replace(/[*"':()&|~]/g, "").trim();
  if (!cleaned) return [];

  const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return [];

  let sql: string;
  let formattedQuery: string;

  if (isEthiopic(cleaned)) {
    // Amharic search: normalize query tokens and append prefix *
    const normalizedTokens = tokens.map(t => normalizeAmharic(t));
    formattedQuery = normalizedTokens.map(t => `${t}*`).join(" AND ");

    sql = `
      SELECT v.book, v.chapter, v.verse, v.text_am, v.text_en, b.name_am, b.name_en
      FROM verses v
      JOIN books b ON v.book = b.id
      JOIN verses_fts f ON v.rowid = f.rowid
      WHERE f.search_am MATCH ?
      LIMIT 50
    `;
  } else {
    // English search: append prefix *
    formattedQuery = tokens.map(t => `${t}*`).join(" AND ");

    sql = `
      SELECT v.book, v.chapter, v.verse, v.text_am, v.text_en, b.name_am, b.name_en
      FROM verses v
      JOIN books b ON v.book = b.id
      JOIN verses_fts f ON v.rowid = f.rowid
      WHERE f.text_en MATCH ?
      LIMIT 50
    `;
  }

  try {
    const rows = await db.getAllAsync<VerseResult>(sql, [formattedQuery]);
    return rows;
  } catch (err) {
    console.error("FTS5 Bible Search Failed:", err);
    return [];
  }
}
