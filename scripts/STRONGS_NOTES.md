# Strong's Lexicon Data Staging & Research Notes

This document captures the research, record-keeping, and database preparation findings for the proposed Strong's Concordance feature in the **Birhan Bible App**.

---

## 1. Audience Constraint & Open Product Decision

> [!IMPORTANT]
> **Key Technical Constraint**: There is no public domain (or existing) Strong's tagging mapped directly to the Amharic translation text. Strong's Concordance number tags map specifically and structurally to the English King James Version (KJV). Translating or aligning these tags to a completely different language family like Amharic is a massive undertaking beyond the scope of this project.

### Audience Constraint Analysis
1. **Language Barrier**: All dictionary definitions, transliterations, pronunciations, and root-derivation glosses are written in English.
2. **View Limitations**: Consequently, the tap-to-define interlinear functionality can **only** surface when the reader is in **English-only** (`en`) or **Parallel** (`both`) view modes.
3. **Target Audience**: The feature serves only bilingual pastors, scholars, and students who read English and are looking for Greek/Hebrew root-word analysis. It provides zero value to Amharic-only readers.

### Open Product Decision
* **Question**: Is the bilingual audience large enough to justify the additional UI complexity, database footprint, and interaction surface?
* **Verdict**: We will stage the database structures and pipeline now, but **do not build the tap-to-define UI**. The final decision to compile this interface into the app is deferred until pilot-church testing and initial feedback on bilingual usage are completed.

---

## 2. Verse Count & Empty Verse Reconciliation

### Verse Count Reconciliation (31,102 vs 31,114)
* **Standard KJV Verse Count**: A standard Protestant KJV Bible contains **31,102** verses.
* **Birhan DB Verse Count (`bible_v3.db`)**: The compiled database contains **31,114** verses.
* **Why the Count Changed**: The database builder script `build_bible_db.js` uses `Math.max(amMax, enMax)` per chapter. This aligns the two translations but inserts blank placeholder verses (padding) where the Amharic translation contains *more* verses in a chapter than the English translation due to differences in versification:
  * **Job 40**: Adds **8** verses (Amharic has 32 verses vs KJV's 24).
  * **Psalms 14**: Adds **3** verses (Amharic has 10 verses vs KJV's 7).
  * **3 John 1**: Adds **1** verse (Amharic has 15 verses vs KJV's 14).
  * *Discrepancy & Split Corrections*: 
    * Exactly **6 missing verses** in the raw JSON KJV source have been patched in memory (Matthew 2:16, Matthew 22:1, Matthew 26:38, Mark 4:40, Mark 7:11, Mark 8:8).
    * Exactly **4 split verses** in the raw JSON KJV source have been merged back to standard KJV versification (1 Samuel 20:42, 1 Kings 22:43, Revelation 13:1, and 3 John 1:14).
  * **Result**: `31,102 (standard KJV English) + 12 (Amharic-led empty English verses) = 31,114 total verses`.

### Empty Verses Reconciliation (409 vs 387)
Across both language columns, there are exactly **409 blank verses** in `bible_v3.db`:
1. **Empty English Columns (`text_en = ''`)**: **12** verses
   * *Verses*: Job 40:25–32 (8), Psalms 14:8–10 (3), 3 John 1:15 (1).
2. **Empty Amharic Columns (`text_am = ''`)**: **397** verses
   * *Merged via `am_merge_head`*: **387** verses (successfully mapped to a subsequent verse row containing text within the same chapter).
   * *Unmerged (`am_merge_head = verse`)*: **10** verses. These are blank Amharic verses located at the very end of their respective chapters, meaning there is no forward text-bearing verse row to merge them into.
3. **Reconciliation**:
   * `387 (merged blanks) + 10 (unmerged blanks) = 397 total Amharic blanks`.
   * `397 (Amharic blanks) + 12 (English blanks) = 409 total blanks`.
   * The **22** difference between the 409 total blanks and the 387 merged blanks consists of **12** English-blank verses and the **10** unmerged end-of-chapter Amharic-blank verses.

#### List of the 10 Unmerged End-of-Chapter Blanks:
* 1 Samuel 13:23 (book 9)
* 1 Samuel 21:15 (book 9)
* 2 Kings 11:21 (book 12)
* Job 41:34 (book 18)
* Psalms 78:72 (book 19)
* Jeremiah 11:23 (book 24)
* Hosea 1:11 (book 28)
* Hosea 11:12 (book 28)
* Jonah 1:17 (book 32)
* 1 Corinthians 7:40 (book 46)

---

## 3. Staged Datasets & Licensing Verification

We have successfully retrieved, validated, and staged the following public domain datasets:

### Strong's Hebrew & Greek Dictionaries
* **Source**: Derived from the [openscriptures/strongs](https://github.com/openscriptures/strongs) project, which digitized James Strong's original Hebrew and Greek Lexicons.
* **Entries Count**:
  * **Hebrew (H1–H8674)**: 8,674 entries.
  * **Greek (G1–G5624)**: 5,523 entries (note: 101 numbers in the G1–G5624 range are empty/skipped historically in Strong's original index, which is expected).
  * **Total**: 14,197 combined entries.
* **Licensing Verification**:
  * **Original Text**: James Strong's Exhaustive Concordance (published 1890) is in the **Public Domain**.
  * **Digital Derivative**: The JSON representations produced by the Open Scriptures project are distributed under the **Creative Commons Attribution-ShareAlike 3.0 (CC-BY-SA 3.0)** license.

### KJV Tagged Text (Interlinear Concordance)
* **Source**: Sourced from the [tahmmee/interlinear_bibledata](https://github.com/tahmmee/interlinear_bibledata) project (dedicated to the **Public Domain**, CC0).
* **Tag Count**: 445,326 word-level tags.
* **Coverage**: Complete coverage of all **66 books** (31,102 verses total).
* **Alignment Verification**: Aligns perfectly with our standard KJV versification structure.

---

## 4. CC-BY-SA 3.0 Licensing Obligations

> [!WARNING]
> **Legal Review Flag**: The Strong's dictionary data is licensed under CC-BY-SA 3.0 (ShareAlike). While we have isolated this data into a separate database file (`strongs_v1.db`), isolating the asset does not automatically exempt the surrounding application code from copyleft triggers.
>
> If the application code is tightly integrated with the database schemas or queries (creating a "Derivative Work" rather than a mere "Collective Work"), a court could interpret the entire binary as subject to ShareAlike (forcing the source code to be open-source). **Legal counsel must review this coupling before shipping.**

### Attribution Required
To comply with the Attribution clause, a credit screen in the application (e.g., Settings > About > Open Source Licenses) must display the following credit line:

```text
Strong's Greek and Hebrew Dictionaries are provided by the Open Scriptures project (https://github.com/openscriptures/strongs) and licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported License (CC-BY-SA 3.0). The digital files have been compiled and structured into an SQLite index for offline use.
```

---

## 5. Database Architecture (`strongs_v1.db`)

To avoid bloat and isolate licenses, we compiled all Strong's resources into a separate database file at [assets/strongs_v1.db](file:///home/killer/Documents/birhan/assets/strongs_v1.db).

### Schema
```sql
CREATE TABLE strongs (
  id TEXT PRIMARY KEY,          -- 'H1', 'G5457'
  lang TEXT NOT NULL,           -- 'hebrew' | 'greek'
  lemma TEXT,                   -- אָב , φῶς
  translit TEXT,                -- 'ab', 'phos'
  definition_en TEXT NOT NULL,
  kjv_usage TEXT
);

-- Word-level tags for KJV alignment
CREATE TABLE kjv_tags (
  book INTEGER, 
  chapter INTEGER, 
  verse INTEGER,
  word_index INTEGER, 
  word TEXT, 
  strongs_id TEXT
);
CREATE INDEX idx_kjv_tags_ref ON kjv_tags(book, chapter, verse);
```

---

## 6. Verification & Sample Lookup Proof

A test script was executed to perform a sample lookup for the word **"light"** in **John 1:5**:
1. **Query**: Find word tags for John (Book ID 43), Chapter 1, Verse 5 in `kjv_tags`.
2. **Result**:
   ```json
   {
     "book": 43,
     "chapter": 1,
     "verse": 5,
     "word_index": 2,
     "word": "the light",
     "strongs_id": "G5457"
   }
   ```
3. **Query Dictionary**: Fetch Strong's definition for `G5457` in `strongs`.
4. **Result**:
   ```json
   {
     "id": "G5457",
     "lang": "greek",
     "lemma": "φῶς",
     "translit": "phōs",
     "definition_en": "(compare G5316 (φαίνω), G5346 (φημί)); luminousness (in the widest application, natural or artificial, abstract or concrete, literal or figurative)",
     "kjv_usage": "fire, light"
   }
   ```

---

## 7. Remaining Known Issues

The following data-quality issues are known and logged for future reference:
1. **Unicode/Transliteration Diacritics**: Transliteration strings (e.g. `xlit` in Hebrew like `ʼâb` or Greek `phōs`) utilize unicode diacritics. If we implement a search feature against transliterations, we will need to strip diacritics to allow plain-text searches.
2. **Historically Skipped Entry Numbers**: The Greek dictionary contains exactly 101 empty numbers in the range `G1–G5624` (e.g., G2717, G3201... are skipped). This is a legacy of Strong's original publication and is not a data loss error.
3. **Archaic Punctuation Alignment**: Interlinear word tags match the spelling and punctuation of the KJV 1769 Cambridge edition. If the English translation displayed in the UI is swapped for a modernized KJV, some word-level mappings might fail to match strings exactly.
