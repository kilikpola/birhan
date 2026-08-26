import * as SQLite from "expo-sqlite";

let localDbInstance: SQLite.SQLiteDatabase | null = null;
let localDbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let writeMutexPromise: Promise<any> = Promise.resolve();

/**
 * Runs a function exclusively in a global promise chain queue,
 * guaranteeing no two database operations execute concurrently on the local database connection.
 */
export async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = writeMutexPromise;
  let release: () => void = () => {};
  writeMutexPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

/**
 * Runs a transactional write operation exclusively in the queue using withExclusiveTransactionAsync if available.
 * Passes the active transaction handle (txn) into task so statements execute within the exclusive transaction.
 */
export async function runTransactionExclusive(
  db: SQLite.SQLiteDatabase,
  task: (txn: SQLite.SQLiteDatabase) => Promise<void>
): Promise<void> {
  return runExclusive(async () => {
    if (typeof (db as any).withExclusiveTransactionAsync === 'function') {
      await (db as any).withExclusiveTransactionAsync((txn: any) => task(txn));
      return;
    }
    await (db as any).withTransactionAsync((txn: any) => task(txn || db));
  });
}

/**
 * Initializes and returns the writable local SQLite database handle,
 * executing table migrations if they do not exist.
 * Uses a single initialization promise to prevent race conditions.
 */
export async function getLocalDb(): Promise<SQLite.SQLiteDatabase> {
  if (localDbInstance) return localDbInstance;
  if (!localDbInitPromise) {
    localDbInitPromise = (async () => {
      const dbInstance = await SQLite.openDatabaseAsync("local.db");

      // Enable foreign keys and run local state table schema creation
      await dbInstance.execAsync(`
        PRAGMA foreign_keys = ON;
        
        CREATE TABLE IF NOT EXISTS highlights (
          id TEXT PRIMARY KEY,
          book INTEGER NOT NULL,
          chapter INTEGER NOT NULL,
          verse INTEGER NOT NULL,
          color TEXT,
          note TEXT,
          updated_at INTEGER NOT NULL,
          synced INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS bookmarks (
          id TEXT PRIMARY KEY,
          book INTEGER NOT NULL,
          chapter INTEGER NOT NULL,
          verse INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          synced INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS reading_position (
          book INTEGER NOT NULL,
          chapter INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (book, chapter)
        );

        CREATE TABLE IF NOT EXISTS ann_cache (
          id TEXT PRIMARY KEY,
          church_id TEXT,
          title_am TEXT,
          title_en TEXT,
          body TEXT,
          locked INTEGER,
          posted_to_telegram INTEGER,
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY,
          announcement_id TEXT,
          author_id TEXT,
          author_name TEXT,
          text TEXT,
          created_at TEXT,
          attempts INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS replies_cache (
          id TEXT PRIMARY KEY,
          announcement_id TEXT,
          author_id TEXT,
          author_name TEXT,
          text TEXT,
          created_at TEXT
        );
      `);

      // Ensure columns exist on pre-existing database tables
      try {
        await dbInstance.execAsync("ALTER TABLE bookmarks ADD COLUMN synced INTEGER DEFAULT 0;");
      } catch (_) {}
      try {
        await dbInstance.execAsync("ALTER TABLE highlights ADD COLUMN synced INTEGER DEFAULT 0;");
      } catch (_) {}
      try {
        await dbInstance.execAsync("ALTER TABLE highlights ADD COLUMN note TEXT;");
      } catch (_) {}

      localDbInstance = dbInstance;
      return dbInstance;
    })();
  }
  return localDbInitPromise;
}

/** Persist the user's last-read book/chapter in the writable local DB. */
export async function saveReadingPosition(book: number, chapter: number): Promise<void> {
  const localDb = await getLocalDb();
  await runTransactionExclusive(localDb, async (txn) => {
    await txn.runAsync(
      'INSERT OR REPLACE INTO reading_position (book, chapter, updated_at) VALUES (?, ?, ?)',
      [book, chapter, Date.now()],
    );
  });
}
