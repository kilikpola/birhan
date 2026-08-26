import { db } from "./index.js";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await db.execute(sql.raw(sqlContent));
    console.log(`Applied migration: ${file}`);
  }

  console.log("Migrations complete");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
