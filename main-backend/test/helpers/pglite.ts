import { PGlite } from "@electric-sql/pglite";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Client } from "pg";

const root = join(import.meta.dir, "../..");

async function runDir(db: PGlite, dir: string) {
  for (const file of (await readdir(join(root, dir))).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(await Bun.file(join(root, dir, file)).text());
  }
}

/**
 * A real Postgres (PGlite, in memory) with the better-auth and app migrations applied, wrapped to look
 * like the `pg.Client` the lib functions take. Use it for SQL that fake-pg cannot pattern-match.
 */
export async function createTestDb() {
  const db = new PGlite();
  await runDir(db, "better-auth_migrations");
  await runDir(db, "migrations");

  const client = {
    query: async (sql: string, params: unknown[] = []) => db.query(sql, params),
  } as unknown as Client;

  return { db, client };
}
