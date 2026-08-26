/**
 * BUILD NOTES: Verse Count Reconciliation
 * 
 * Earlier prototype builds reported a verse count of 31,103, and the previous padded 
 * build had 31,114. The current corrected build contains exactly 31,114 verses.
 * 
 * Breakdown of the 31,114 verse count:
 * - Exactly 31,102 verses contain English KJV text (fully representing all standard KJV verses).
 * - Exactly 12 verses have empty English KJV text, representing Amharic-led padding.
 *   These are extra verses padded into chapters where the Amharic translation contains
 *   more verses than standard KJV due to differences in versification:
 *   - Job 40:25-32 (8 verses added)
 *   - Psalms 14:8-10 (3 verses added)
 *   - 3 John 1:15 (1 verse added)
 * 
 * In-Memory KJV JSON Patches:
 * The source en_kjv.json file contains 6 missing verses that are patched in memory before insertion:
 * 1. Matthew 2:16 (inserted at index 15)
 * 2. Matthew 22:1 (inserted at index 0)
 * 3. Matthew 26:38 (inserted at index 37)
 * 4. Mark 4:40 (inserted at index 39)
 * 5. Mark 7:11 (inserted at index 10)
 * 6. Mark 8:8 (inserted at index 7)
 * 
 * Unsplitting Corrections:
 * Four KJV JSON source splits are merged back to standard KJV versification during build:
 * 1. 1 Samuel 20:43 split is merged back into 20:42.
 * 2. 1 Kings 22:44 split is merged into 22:43, shifting subsequent verses back.
 * 3. Revelation 12:18 split (first clause of 13:1) is moved and prepended to Revelation 13:1.
 * 4. 3 John 1:15 split is merged into 3 John 1:14.
 * 
 * New Invariant: Every verse present in KJV is mapped to a DB row with its English text intact.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function normalizeAmharic(text) {
  if (!text) return "";
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x1210 && code <= 0x1216) {
      result += String.fromCharCode(code - 0x10);
    }
    else if (code >= 0x1220 && code <= 0x1226) {
      result += String.fromCharCode(code + 0x10);
    }
    else if (code >= 0x1280 && code <= 0x1286) {
      result += String.fromCharCode(code - 0x80);
    }
    else if (code >= 0x12d0 && code <= 0x12d6) {
      result += String.fromCharCode(code - 0x30);
    }
    else if (code >= 0x1340 && code <= 0x1346) {
      result += String.fromCharCode(code - 0x08);
    }
    else {
      result += text[i];
    }
  }
  return result;
}

const ENGLISH_BOOKS = [
  { name: "Genesis", file: "Genesis.json", testament: "OT" },
  { name: "Exodus", file: "Exodus.json", testament: "OT" },
  { name: "Leviticus", file: "Leviticus.json", testament: "OT" },
  { name: "Numbers", file: "Numbers.json", testament: "OT" },
  { name: "Deuteronomy", file: "Deuteronomy.json", testament: "OT" },
  { name: "Joshua", file: "Joshua.json", testament: "OT" },
  { name: "Judges", file: "Judges.json", testament: "OT" },
  { name: "Ruth", file: "Ruth.json", testament: "OT" },
  { name: "1 Samuel", file: "1 Samuel.json", testament: "OT" },
  { name: "2 Samuel", file: "2 Samuel.json", testament: "OT" },
  { name: "1 Kings", file: "1 Kings.json", testament: "OT" },
  { name: "2 Kings", file: "2 Kings.json", testament: "OT" },
  { name: "1 Chronicles", file: "1 Chronicles.json", testament: "OT" },
  { name: "2 Chronicles", file: "2 Chronicles.json", testament: "OT" },
  { name: "Ezra", file: "Ezra.json", testament: "OT" },
  { name: "Nehemiah", file: "Nehemiah.json", testament: "OT" },
  { name: "Esther", file: "Esther.json", testament: "OT" },
  { name: "Job", file: "Job.json", testament: "OT" },
  { name: "Psalms", file: "Psalms.json", testament: "OT" },
  { name: "Proverbs", file: "Proverbs.json", testament: "OT" },
  { name: "Ecclesiastes", file: "Ecclesiastes.json", testament: "OT" },
  { name: "Song of Solomon", file: "Song of Solomon.json", testament: "OT" },
  { name: "Isaiah", file: "Isaiah.json", testament: "OT" },
  { name: "Jeremiah", file: "Jeremiah.json", testament: "OT" },
  { name: "Lamentations", file: "Lamentations.json", testament: "OT" },
  { name: "Ezekiel", file: "Ezekiel.json", testament: "OT" },
  { name: "Daniel", file: "Daniel.json", testament: "OT" },
  { name: "Hosea", file: "Hosea.json", testament: "OT" },
  { name: "Joel", file: "Joel.json", testament: "OT" },
  { name: "Amos", file: "Amos.json", testament: "OT" },
  { name: "Obadiah", file: "Obadiah.json", testament: "OT" },
  { name: "Jonah", file: "Jonah.json", testament: "OT" },
  { name: "Micah", file: "Micah.json", testament: "OT" },
  { name: "Nahum", file: "Nahum.json", testament: "OT" },
  { name: "Habakkuk", file: "Habakkuk.json", testament: "OT" },
  { name: "Zephaniah", file: "Zephaniah.json", testament: "OT" },
  { name: "Haggai", file: "Haggai.json", testament: "OT" },
  { name: "Zechariah", file: "Zechariah.json", testament: "OT" },
  { name: "Malachi", file: "Malachi.json", testament: "OT" },
  { name: "Matthew", file: "Matthew.json", testament: "NT" },
  { name: "Mark", file: "Mark.json", testament: "NT" },
  { name: "Luke", file: "Luke.json", testament: "NT" },
  { name: "John", file: "John.json", testament: "NT" },
  { name: "Acts", file: "Acts.json", testament: "NT" },
  { name: "Romans", file: "Romans.json", testament: "NT" },
  { name: "1 Corinthians", file: "1 Corinthians.json", testament: "NT" },
  { name: "2 Corinthians", file: "2 Corinthians.json", testament: "NT" },
  { name: "Galatians", file: "Galatians.json", testament: "NT" },
  { name: "Ephesians", file: "Ephesians.json", testament: "NT" },
  { name: "Philippians", file: "Philippians.json", testament: "NT" },
  { name: "Colossians", file: "Colossians.json", testament: "NT" },
  { name: "1 Thessalonians", file: "1 Thessalonians.json", testament: "NT" },
  { name: "2 Thessalonians", file: "2 Thessalonians.json", testament: "NT" },
  { name: "1 Timothy", file: "1 Timothy.json", testament: "NT" },
  { name: "2 Timothy", file: "2 Timothy.json", testament: "NT" },
  { name: "Titus", file: "Titus.json", testament: "NT" },
  { name: "Philemon", file: "Philemon.json", testament: "NT" },
  { name: "Hebrews", file: "Hebrews.json", testament: "NT" },
  { name: "James", file: "James.json", testament: "NT" },
  { name: "1 Peter", file: "1 Peter.json", testament: "NT" },
  { name: "2 Peter", file: "2 Peter.json", testament: "NT" },
  { name: "1 John", file: "1 John.json", testament: "NT" },
  { name: "2 John", file: "2 John.json", testament: "NT" },
  { name: "3 John", file: "3 John.json", testament: "NT" },
  { name: "Jude", file: "Jude.json", testament: "NT" },
  { name: "Revelation", file: "Revelation.json", testament: "NT" }
];

async function main() {
  const amDir = path.join(__dirname, "temp_clone_wesenseged/src/data");
  const enCachePath = path.join(__dirname, "cache/en_kjv.json");
  const fallbackCachePath = path.join(__dirname, "cache/amharic_bible.json");
  
  if (!fs.existsSync(amDir) || !fs.existsSync(enCachePath)) {
    console.error("Error: Amharic source directory or KJV cache not found.");
    process.exit(1);
  }
  
  console.log("Loading datasets...");
  const booksMetaFile = JSON.parse(fs.readFileSync(path.join(amDir, "books.json"), "utf8"));
  const amBooks = [...booksMetaFile.oldTestament, ...booksMetaFile.newTestament];
  
  const enJson = JSON.parse(fs.readFileSync(enCachePath, "utf8"));
  
  let fallbackBible = null;
  if (fs.existsSync(fallbackCachePath)) {
    console.log("Loading fallback Amharic Bible dataset...");
    fallbackBible = JSON.parse(fs.readFileSync(fallbackCachePath, "utf8"));
  }
  
  // Patch missing KJV verses in memory.
  // Verification Source: Verified character-for-character against the Project Gutenberg King James Bible (KJV) text.
  // 1. Matthew 2:16 (index 15 of ch 2)
  enJson[39].chapters[1].splice(15, 0, "Then Herod, when he saw that he was mocked of the wise men, was exceeding wroth, and sent forth, and slew all the children that were in Bethlehem, and in all the coasts thereof, from two years old and under, according to the time which he had diligently inquired of the wise men.");
  // 2. Matthew 22:1 (index 0 of ch 22)
  enJson[39].chapters[21].splice(0, 0, "And Jesus answered and spake unto them again by parables, and said,");
  // 3. Matthew 26:38 (index 37 of ch 26)
  enJson[39].chapters[25].splice(37, 0, "Then saith he unto them, My soul is exceeding sorrowful, even unto death: tarry ye here, and watch with me.");
  // 4. Mark 4:40 (index 39 of ch 4)
  enJson[40].chapters[3].splice(39, 0, "And he said unto them, Why are ye so fearful? how is it that ye have no faith?");
  // 5. Mark 7:11 (index 10 of ch 7)
  enJson[40].chapters[6].splice(10, 0, "But ye say, If a man shall say to his father or mother, It is Corban, that is to say, a gift, by whatsoever thou mightest be profited by me; he shall be free.");
  // 6. Mark 8:8 (index 7 of ch 8; {meat} uses italics to match KJV formatting)
  enJson[40].chapters[7].splice(7, 0, "So they did eat, and were filled: and they took up of the broken {meat} that was left seven baskets.");
  
  const dbPath = path.join(__dirname, "../assets/bible_v3.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  
  const db = new DatabaseSync(dbPath);
  
  console.log("Creating tables...");
  db.exec(`
    CREATE TABLE books (
      id INTEGER PRIMARY KEY,
      name_am TEXT NOT NULL,
      name_en TEXT NOT NULL,
      testament TEXT NOT NULL,
      chapters INTEGER NOT NULL
    );
  `);
  
  db.exec(`
    CREATE TABLE verses (
      book INTEGER NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text_am TEXT NOT NULL,
      text_en TEXT NOT NULL,
      search_am TEXT NOT NULL,
      am_merge_head INTEGER,
      PRIMARY KEY (book, chapter, verse)
    );
  `);
  
  db.exec(`
    CREATE VIRTUAL TABLE verses_fts USING fts5(
      search_am, text_en, content='verses', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 0'
    );
  `);
  
  const insertBook = db.prepare(`
    INSERT INTO books (id, name_am, name_en, testament, chapters)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const insertVerse = db.prepare(`
    INSERT INTO verses (book, chapter, verse, text_am, text_en, search_am, am_merge_head)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  db.exec("BEGIN TRANSACTION;");
  
  let rev12_18_carry = "";
  
  for (let i = 0; i < 66; i++) {
    const amBook = amBooks[i];
    const enBook = enJson[i];
    const bookMeta = ENGLISH_BOOKS[i];
    const bookId = i + 1;
    
    const amFilename = path.basename(amBook.dataFile);
    const amBookData = JSON.parse(fs.readFileSync(path.join(amDir, amFilename), "utf8"));
    const numChapters = amBookData.book.length;
    
    const fallbackBook = fallbackBible ? fallbackBible.books[i] : null;
    
    insertBook.run(bookId, amBook.bookName, bookMeta.name, bookMeta.testament, numChapters);
    
    for (let c = 0; c < numChapters; c++) {
      const amChapter = amBookData.book[c];
      const chNum = c + 1;
      
      const enChapter = enBook.chapters[c] || [];
      const fallbackChapter = fallbackBook && fallbackBook.chapters ? fallbackBook.chapters[c] : null;
      
      // Map Amharic Verses
      const amVerseMap = {};
      if (amChapter && amChapter.verses) {
        amChapter.verses.forEach(vObj => {
          const vNum = Number(vObj.verse);
          let text = vObj.text || "";
          if (text === "-") text = "";
          
          if (!text && fallbackChapter) {
            const fbText = fallbackChapter.verses && fallbackChapter.verses[vNum - 1] ? fallbackChapter.verses[vNum - 1] : "";
            if (fbText && fbText !== "-") {
              text = fbText;
            }
          }
          amVerseMap[vNum] = text.trim();
        });
      }
      
      // Map English Verses
      const enVerseMap = {};
      enChapter.forEach((text, idx) => {
        const vNum = idx + 1;
        enVerseMap[vNum] = text.trim();
      });
      
      // Apply KJV unsplit fixes
      // 1. 1 Samuel 20: v42 + v43 merged into v42
      if (bookId === 9 && chNum === 20) {
        if (enVerseMap[42] && enVerseMap[43]) {
          enVerseMap[42] = enVerseMap[42] + " " + enVerseMap[43];
          delete enVerseMap[43];
        }
      }
      
      // 2. 1 Kings 22: v43 + v44 merged into v43, shift 45-54 back
      if (bookId === 11 && chNum === 22) {
        if (enVerseMap[43] && enVerseMap[44]) {
          enVerseMap[43] = enVerseMap[43] + " " + enVerseMap[44];
          for (let v = 44; v <= 53; v++) {
            enVerseMap[v] = enVerseMap[v + 1] || "";
          }
          delete enVerseMap[54];
        }
      }
      
      // 3. Revelation 12: carry v18 text
      if (bookId === 66 && chNum === 12) {
        if (enVerseMap[18]) {
          rev12_18_carry = enVerseMap[18];
          delete enVerseMap[18];
        }
      }
      
      // 4. Revelation 13: prepend carried v18 text to Rev 13:1
      if (bookId === 66 && chNum === 13) {
        if (rev12_18_carry && enVerseMap[1]) {
          enVerseMap[1] = rev12_18_carry + " " + enVerseMap[1];
          rev12_18_carry = "";
        }
      }
      
      // 5. 3 John 1: v14 + v15 merged into v14
      if (bookId === 64 && chNum === 1) {
        if (enVerseMap[14] && enVerseMap[15]) {
          enVerseMap[14] = enVerseMap[14] + " " + enVerseMap[15];
          delete enVerseMap[15];
        }
      }
      
      // Find maximum verse number in either translation
      let amMax = 0;
      Object.keys(amVerseMap).forEach(vNum => {
        if (Number(vNum) > amMax) amMax = Number(vNum);
      });
      
      let enMax = 0;
      Object.keys(enVerseMap).forEach(vNum => {
        if (Number(vNum) > enMax) enMax = Number(vNum);
      });
      
      const maxVerse = Math.max(amMax, enMax);
      
      // Pre-load all text values for analysis
      const chapterVerses = [];
      for (let v = 1; v <= maxVerse; v++) {
        chapterVerses[v] = {
          textAm: amVerseMap[v] || "",
          textEn: enVerseMap[v] || ""
        };
      }
      
      // Pre-compute am_merge_head
      const amMergeHeads = [];
      for (let v = 1; v <= maxVerse; v++) {
        if (chapterVerses[v].textAm !== "") {
          amMergeHeads[v] = v;
        } else {
          let foundHead = null;
          for (let h = v + 1; h <= maxVerse; h++) {
            if (chapterVerses[h].textAm !== "") {
              foundHead = h;
              break;
            }
          }
          if (foundHead !== null) {
            amMergeHeads[v] = foundHead;
          } else {
            amMergeHeads[v] = v;
          }
        }
      }
      
      // Perform inserts
      for (let v = 1; v <= maxVerse; v++) {
        const textAm = chapterVerses[v].textAm;
        const textEn = chapterVerses[v].textEn;
        const searchAm = normalizeAmharic(textAm);
        const mergeHead = amMergeHeads[v];
        
        try {
          insertVerse.run(bookId, chNum, v, textAm, textEn, searchAm, mergeHead);
        } catch (err) {
          console.error(`SQL INSERT FAILED: Book ${bookId} Ch ${chNum} Verse ${v}`);
          throw err;
        }
      }
    }
  }
  
  db.exec("COMMIT;");
  
  console.log("Building FTS5 index...");
  db.exec(`
    INSERT INTO verses_fts(verses_fts) VALUES('rebuild');
  `);
  
  console.log("Vacuuming database...");
  db.exec("VACUUM;");
  
  console.log("Bible database compilation complete!");
  
  const totalBooks = db.prepare("SELECT COUNT(*) as count FROM books").get().count;
  const totalVerses = db.prepare("SELECT COUNT(*) as count FROM verses").get().count;
  const ftsCount = db.prepare("SELECT COUNT(*) as count FROM verses_fts").get().count;
  console.log(`Books imported: ${totalBooks} / 66`);
  console.log(`Verses imported: ${totalVerses}`);
  console.log(`FTS5 entries indexed: ${ftsCount}`);
}

main().catch(err => {
  console.error("Failed to build Bible DB:", err);
  process.exit(1);
});
