import "dotenv/config";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "@/backend/src/config";
import { createPool } from "@/backend/src/db/pool";

export async function runMigrations(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL, config.DATABASE_SSL_MODE);
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const migrationsRoot = path.join(process.cwd(), "backend", "migrations");
    const files = (await readdir(migrationsRoot)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const alreadyApplied = await client.query(
        "SELECT 1 FROM app_migrations WHERE version = $1",
        [file],
      );
      if (alreadyApplied.rowCount) continue;

      await client.query("BEGIN");
      try {
        await client.query(await readFile(path.join(migrationsRoot, file), "utf8"));
        await client.query("INSERT INTO app_migrations(version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.info(`Applied migration ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch((error) => {
    console.error("Database migration failed", error);
    process.exitCode = 1;
  });
}
