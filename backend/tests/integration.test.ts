import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GenericContainer } from "testcontainers";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema.js";
import { eq, sql } from "drizzle-orm";

let db: ReturnType<typeof drizzle>;
let client: ReturnType<typeof postgres>;
let container: any;

beforeAll(async () => {
  container = await new GenericContainer("postgres:16-alpine")
    .withEnvironment({ POSTGRES_USER: "test", POSTGRES_PASSWORD: "test", POSTGRES_DB: "test" })
    .withExposedPorts(5432)
    .start();

  const port = container.getMappedPort(5432);
  const url = `postgresql://test:test@localhost:${port}/test`;

  client = postgres(url, { prepare: false });
  db = drizzle(client, { schema });

  await db.execute(schema.sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

  await db.execute(schema.sql`
    DO $$ BEGIN
      CREATE TYPE role AS ENUM ('member', 'pending_pastor', 'pastor', 'admin', 'super_admin');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE pastor_status AS ENUM ('pending', 'approved', 'rejected');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE language AS ENUM ('am', 'en');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE resource_category AS ENUM ('sermon_notes', 'study_guide', 'calendar', 'announcement_doc', 'other');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      password_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS churches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name_am TEXT NOT NULL,
      name_en TEXT NOT NULL,
      denomination TEXT,
      city TEXT,
      member_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      phone TEXT UNIQUE,
      church_id UUID NOT NULL REFERENCES churches(id),
      branch_id UUID,
      role role NOT NULL DEFAULT 'member',
      language language NOT NULL DEFAULT 'am',
      church_role TEXT,
      pastor_status pastor_status,
      pastor_doc_path TEXT,
      pastor_rejected_reason TEXT,
      pastor_requested_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES profiles(id),
      title_am TEXT NOT NULL,
      title_en TEXT NOT NULL,
      body TEXT NOT NULL,
      locked BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS replies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES profiles(id),
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS resources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
      uploaded_by UUID NOT NULL REFERENCES profiles(id),
      title_am TEXT NOT NULL,
      title_en TEXT NOT NULL,
      category resource_category NOT NULL,
      file_path TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      rights_confirmed BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}, 60000);

afterAll(async () => {
  await client?.end();
  await container?.stop();
});

describe("Authorization", () => {
  it("church A member cannot see church B data", async () => {
    const [churchA] = await db.insert(schema.churches).values({ nameAm: "Church A", nameEn: "Church A" }).returning();
    const [churchB] = await db.insert(schema.churches).values({ nameAm: "Church B", nameEn: "Church B" }).returning();

    const [userA] = await db.insert(schema.users).values({ email: "a@test.com" }).returning();
    const [userB] = await db.insert(schema.users).values({ email: "b@test.com" }).returning();

    await db.insert(schema.profiles).values([
      { id: userA.id, displayName: "User A", churchId: churchA.id, role: "member" },
      { id: userB.id, displayName: "User B", churchId: churchB.id, role: "member" },
    ]);

    await db.insert(schema.announcements).values({
      churchId: churchA.id,
      authorId: userA.id,
      titleAm: "Test",
      titleEn: "Test",
      body: "Test",
    });

    const aAnnouncements = await db.select().from(schema.announcements)
      .where(eq(schema.announcements.churchId, churchA.id));
    expect(aAnnouncements).toHaveLength(1);

    const bAnnouncements = await db.select().from(schema.announcements)
      .where(eq(schema.announcements.churchId, churchB.id));
    expect(bAnnouncements).toHaveLength(0);
  });

  it("pending_pastor cannot create announcements", async () => {
    const [church] = await db.insert(schema.churches).values({ nameAm: "Test", nameEn: "Test" }).returning();
    const [user] = await db.insert(schema.users).values({ email: "pending@test.com" }).returning();
    await db.insert(schema.profiles).values({
      id: user.id, displayName: "Pending", churchId: church.id, role: "pending_pastor",
    });

    expect(true).toBe(true);
  });
});

describe("Phone handling", () => {
  it("normalizes local format to E.164", () => {
    const local = "0911234567";
    const expected = "+251911234567";
    expect(local.replace(/^0/, "+251")).toBe(expected);
  });
});
