/**
 * An in-process Postgres for the test suite.
 *
 * PGlite rather than a container because these tests have to say something
 * about transaction behaviour — "a failure mid-signup leaves no orphaned auth
 * user" is a claim about ROLLBACK, and only a real Postgres can answer it. It
 * runs anywhere `npm test` runs, with no Docker daemon.
 *
 * Imported by the vi.mock factory that stands in for src/db/index.ts, so the
 * routes under test talk to this database without knowing it.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "../../src/db/schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const client = new PGlite();
export const db = drizzle(client, { schema });

/** Applies the real migration files, so the tests run against the shipped DDL. */
export async function applyMigrations() {
  const dir = path.join(here, "../../src/db/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    // client.exec, not db.execute: a migration file is many statements, and the
    // extended query protocol drizzle uses takes exactly one.
    await client.exec(fs.readFileSync(path.join(dir, file), "utf-8"));
  }
}

/** Wipes every row between tests without paying to rebuild the schema. */
export async function truncateAll() {
  await client.exec(`
    TRUNCATE auth_accounts, auth_verifications, telegram_link_codes,
             email_verification_tokens, replies, announcements, resources,
             profiles, branches, churches, sessions, users
             RESTART IDENTITY CASCADE;
  `);
}
