# Database Optimization Notes: Space Reduction Plan

This document scopes the post-pilot plan to reduce the uncompressed size of `bible_v3.db` from **24.3 MB** to under **18 MB** (and the compressed asset size to under **6 MB**).

---

## The Space Breakdown (Baseline)

* **Total Database Size**: 24.3 MB (25,485,312 bytes)
* **`verses` table**: 17.82 MB (17,825,792 bytes)
  * Stores: `book`, `chapter`, `verse`, `text_am`, `text_en`, `search_am`, `am_merge_head`
* **`verses_fts_data` (FTS5 index)**: 5.95 MB (6,238,208 bytes)
  * Stores: Indexed token indices for `search_am` and `text_en`.

### The Cause of the Size
Amharic Ge'ez characters require **3 bytes per character** in UTF-8. Storing both the original display text (`text_am`) and the normalized search text (`search_am`) in the `verses` table means storing the Amharic text twice:
* `text_am` raw size: **6.43 MB**
* `search_am` raw size: **6.43 MB**
* `text_en` (English KJV) raw size: **4.43 MB**

---

## Scoped Optimization Strategies

To reclaim the **6.43 MB** duplicate column (`search_am`), two options are proposed:

### Option A: Index Raw `text_am` & Normalize at Search Time
Instead of normalizing the Amharic text before storing it in the database, we index raw `text_am` in FTS5 and normalize only the query at search time.

* **Feasibility**: **Low/Unworkable**.
* **Reason**: FTS5 standard tokenizers (`unicode61`) do not map homophone characters (e.g., matching `ጸ` to `ፀ`, or `ሀ` to `ሃ`). If we only normalize the query at search time, it will not match the un-normalized tokens in the index. Writing custom tokenizers in SQLite is not natively supported in React Native without compiling custom native SQLite binaries.
* **Savings**: ~6.43 MB.

### Option B (Recommended): Contentless FTS5 Table
Keep the `search_am` normalization at build time, but do **not** store the `search_am` column in the `verses` table. Instead, configure FTS5 as a **contentless virtual table** (`content=''`).

* **Feasibility**: **High**.
* **Implementation Plan**:
  1. Modify the `verses` table schema to drop the `search_am` column entirely:
     ```sql
     CREATE TABLE verses (
       book INTEGER NOT NULL,
       chapter INTEGER NOT NULL,
       verse INTEGER NOT NULL,
       text_am TEXT NOT NULL,
       text_en TEXT NOT NULL,
       am_merge_head INTEGER,
       PRIMARY KEY (book, chapter, verse)
     );
     ```
  2. Create the virtual table as a contentless index:
     ```sql
     CREATE VIRTUAL TABLE verses_fts USING fts5(
       search_am, text_en, content='',
       tokenize='unicode61 remove_diacritics 0'
     );
     ```
  3. At build time, compute `search_am` in memory and insert both `search_am` and `text_en` directly into the index:
     ```sql
     INSERT INTO verses_fts (rowid, search_am, text_en) VALUES (?, ?, ?);
     ```
  4. At search time, join the contentless index on `v.rowid = f.rowid`:
     ```sql
     SELECT v.book, v.chapter, v.verse, v.text_am, v.text_en
     FROM verses v
     JOIN verses_fts f ON v.rowid = f.rowid
     WHERE f.search_am MATCH ?;
     ```
     *(Since our search query only selects fields from `verses` and never queries columns directly from `verses_fts`, this is 100% compatible).*

* **Expected Savings**: **6.43 MB** (26.5% reduction in uncompressed database size).
* **Expected Uncompressed Size**: **~17.8 MB**
* **Expected Compressed Size**: **~5.5 MB**
