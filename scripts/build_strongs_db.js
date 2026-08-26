const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

function cleanDefinition(def) {
  if (!def) return "";
  let cleaned = def.trim();
  const openCount = (cleaned.match(/\(/g) || []).length;
  const closeCount = (cleaned.match(/\)/g) || []).length;
  if (closeCount > openCount && !cleaned.startsWith('(')) {
    cleaned = '(' + cleaned;
  }
  return cleaned;
}


function buildStrongsDb() {
  console.log("Starting Strong's database compilation...");
  
  const dbPath = path.join(__dirname, "../assets/strongs_v1.db");
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  
  const db = new DatabaseSync(dbPath);
  
  // Create tables
  db.exec(`
    CREATE TABLE strongs (
      id TEXT PRIMARY KEY,
      lang TEXT NOT NULL,
      lemma TEXT,
      translit TEXT,
      definition_en TEXT NOT NULL,
      kjv_usage TEXT
    );
  `);
  
  db.exec(`
    CREATE TABLE kjv_tags (
      book INTEGER,
      chapter INTEGER,
      verse INTEGER,
      word_index INTEGER,
      word TEXT,
      strongs_id TEXT
    );
  `);
  
  db.exec(`
    CREATE INDEX idx_kjv_tags_ref ON kjv_tags(book, chapter, verse);
  `);
  
  // Load dictionaries
  const greekPath = path.join(__dirname, "temp_kjvstudy/kjvstudy.org-main/kjvstudy_org/data/strongs/greek.json");
  const hebrewPath = path.join(__dirname, "temp_kjvstudy/kjvstudy.org-main/kjvstudy_org/data/strongs/hebrew.json");
  
  if (!fs.existsSync(greekPath) || !fs.existsSync(hebrewPath)) {
    console.error("Error: Strong's dictionary JSON files not found!");
    process.exit(1);
  }
  
  const greekDict = JSON.parse(fs.readFileSync(greekPath, 'utf8'));
  const hebrewDict = JSON.parse(fs.readFileSync(hebrewPath, 'utf8'));
  
  const insertStrong = db.prepare(`
    INSERT INTO strongs (id, lang, lemma, translit, definition_en, kjv_usage)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  db.exec("BEGIN TRANSACTION;");
  
  let strongsCount = 0;
  
  // Populate Greek Strong's
  Object.entries(greekDict).forEach(([id, entry]) => {
    insertStrong.run(
      id,
      'greek',
      entry.lemma || null,
      entry.translit || null,
      cleanDefinition(entry.strongs_def),
      entry.kjv_def || null
    );
    strongsCount++;
  });
  
  // Populate Hebrew Strong's
  Object.entries(hebrewDict).forEach(([id, entry]) => {
    insertStrong.run(
      id,
      'hebrew',
      entry.lemma || null,
      entry.translit || entry.xlit || null,
      cleanDefinition(entry.strongs_def),
      entry.kjv_def || null
    );
    strongsCount++;
  });
  
  db.exec("COMMIT;");
  console.log(`Strongs dictionary loaded: ${strongsCount} entries.`);
  
  // Load book mapping from bible_v3.db
  const bibleDbPath = path.join(__dirname, "../assets/bible_v3.db");
  if (!fs.existsSync(bibleDbPath)) {
    console.error("Error: bible_v3.db not found! Please build it first.");
    process.exit(1);
  }
  const bibleDb = new DatabaseSync(bibleDbPath);
  const booksList = bibleDb.prepare("SELECT id, name_en FROM books").all();
  const bookNameToId = {};
  booksList.forEach(b => {
    bookNameToId[b.name_en.toLowerCase()] = b.id;
  });
  // Solomon's Song fallback
  bookNameToId["solomon's song"] = 22;
  
  // Load and unzip interlinear KJV tags
  const interlinearPath = path.join(__dirname, "temp_kjvstudy/kjvstudy.org-main/kjvstudy_org/data/interlinear.json.gz");
  if (!fs.existsSync(interlinearPath)) {
    console.error("Error: interlinear.json.gz not found!");
    process.exit(1);
  }
  
  console.log("Decompressing interlinear data...");
  const interlinearRaw = fs.readFileSync(interlinearPath);
  const interlinearUnzipped = zlib.gunzipSync(interlinearRaw);
  const interlinearData = JSON.parse(interlinearUnzipped.toString('utf8'));
  
  const insertTag = db.prepare(`
    INSERT INTO kjv_tags (book, chapter, verse, word_index, word, strongs_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  db.exec("BEGIN TRANSACTION;");
  
  let tagsCount = 0;
  let skippedVerses = 0;
  
  Object.entries(interlinearData).forEach(([key, tokens]) => {
    const parts = key.split(':');
    if (parts.length !== 3) return;
    const [bookName, chStr, vStr] = parts;
    const bookId = bookNameToId[bookName.toLowerCase()];
    if (!bookId) {
      skippedVerses++;
      return;
    }
    const chapter = parseInt(chStr, 10);
    const verse = parseInt(vStr, 10);
    
    tokens.forEach((token, idx) => {
      if (token.strongs) {
        insertTag.run(
          bookId,
          chapter,
          verse,
          idx,
          token.english || "",
          token.strongs
        );
        tagsCount++;
      }
    });
  });
  
  db.exec("COMMIT;");
  console.log(`KJV tags loaded: ${tagsCount} tags. Skipped verses: ${skippedVerses}`);
  console.log("Strongs database compilation complete!");
}

buildStrongsDb();
