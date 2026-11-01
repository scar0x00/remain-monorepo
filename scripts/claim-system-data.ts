#!/usr/bin/env bun
// One-off for accounts (#12): gives the decks and study history owned by the placeholder `system`
// user to the owner's real account, after they have signed up and verified their email.
//
// Usage (from the repo root):
//   DATABASE_URL=postgres://... bun scripts/claim-system-data.ts --email you@example.com          # dry run
//   DATABASE_URL=postgres://... bun scripts/claim-system-data.ts --email you@example.com --apply
//
// DATABASE_URL is the Neon connection string (not Hyperdrive). R2 objects are copied with
// `wrangler r2 object get/put --remote`, so wrangler must be logged in to the account.
//
// What it does, in this order:
//   1. Copies every `system` deck file `<name>` in R2 to `<ownerId>/<name>`. The originals stay, so
//      nothing is lost if a later step fails; delete them by hand once the app looks right.
//   2. In one transaction, moves the `system` rows of `decks` and `study_sessions` to the owner.
// Running it again is safe: copies are overwritten with the same bytes and no `system` rows remain.
// A deck name the owner already has is skipped and reported, never overwritten.
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const BUCKET = "remain-decks";
const SYSTEM_USER_ID = "system";
const BACKEND = join(import.meta.dir, "..", "main-backend");

const CONTENT_TYPES: Record<string, string> = {
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
};

const { values } = parseArgs({
  options: { email: { type: "string" }, apply: { type: "boolean", default: false } },
});
if (!values.email || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=... bun scripts/claim-system-data.ts --email <owner email> [--apply]");
  process.exit(1);
}

const sql = new SQL(process.env.DATABASE_URL);

async function wrangler(...args: string[]) {
  const proc = Bun.spawn(["bunx", "wrangler", ...args], { cwd: BACKEND, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`wrangler ${args.join(" ")} failed:\n${stderr}`);
}

try {
  const [owner] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM "user" WHERE lower(email) = lower(${values.email}) AND "emailVerified" = true`;
  if (!owner) throw new Error(`No verified account for ${values.email}. Sign up and verify the email first.`);

  const decks = await sql<{ name: string }[]>`SELECT name FROM public.decks WHERE user_id = ${SYSTEM_USER_ID} ORDER BY name`;
  const taken = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM public.decks WHERE user_id = ${owner.id}`).map((row) => row.name),
  );
  const [{ count: sessions }] = await sql<{ count: string }[]>`
    SELECT count(*) FROM public.study_sessions WHERE user_id = ${SYSTEM_USER_ID}`;

  const moving = decks.filter((deck) => !taken.has(deck.name));
  const skipped = decks.filter((deck) => taken.has(deck.name));
  console.log(`Owner: ${owner.name} (${owner.id})`);
  console.log(`Decks to move: ${moving.length}${skipped.length ? `, skipped (name already taken): ${skipped.map((d) => d.name).join(", ")}` : ""}`);
  console.log(`Study sessions to move: ${sessions}`);

  if (!values.apply) {
    console.log("\nDry run. Run again with --apply to copy the files and move the rows.");
    process.exit(0);
  }

  const dir = await mkdtemp(join(tmpdir(), "claim-"));
  try {
    for (const [i, { name }] of moving.entries()) {
      const file = join(dir, String(i));
      const type = CONTENT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
      await wrangler("r2", "object", "get", `${BUCKET}/${name}`, "--remote", "--file", file);
      await wrangler("r2", "object", "put", `${BUCKET}/${owner.id}/${name}`, "--remote", "--file", file, "--content-type", type);
      console.log(`copied ${name} -> ${owner.id}/${name}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  await sql.begin(async (tx) => {
    for (const { name } of moving) {
      await tx`UPDATE public.decks SET user_id = ${owner.id} WHERE user_id = ${SYSTEM_USER_ID} AND name = ${name}`;
    }
    await tx`UPDATE public.study_sessions SET user_id = ${owner.id} WHERE user_id = ${SYSTEM_USER_ID}`;
  });
  console.log("\nDone. Check the app, then delete the old top-level R2 objects:");
  for (const { name } of moving) console.log(`  bunx wrangler r2 object delete ${BUCKET}/${name} --remote`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await sql.close();
}
