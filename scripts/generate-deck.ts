#!/usr/bin/env bun
// Generates a flashcard deck locally with the authenticated `claude` CLI (your Claude subscription).
// Reuses the agent's prompts and schemas. No chunking: all sources go into a single request.
//
// Usage:
//   bun scripts/generate-deck.ts <deckName> <file...> [options]
//
// Options:
//   -c, --count <n>          exact number of cards (default: model decides)
//   -i, --instructions <s>   extra instructions for the model
//   -f, --format <json|yaml> output format (default: json)
//   -m, --model <alias>      claude model alias or full name (default: haiku)
//   -e, --effort <level>     low|medium|high|xhigh|max (default: medium)
//   -o, --overwrite          replace an existing deck file
//
// Text files are inlined in the prompt; PDFs are read by Claude through its Read tool.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { buildCreatePrompt, formatSources, SYSTEM_PROMPT } from "../flashcard-generator-agent/src/prompts";
import { DeckOutputSchema } from "../flashcard-generator-agent/src/schema";
import { serializeDeck } from "../flashcard-generator-agent/src/input";

const OUTPUT_DIR = join(import.meta.dir, "output-decks");
const DECK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const TEXT_FILE_PATTERN = /\.(md|txt|json|ya?ml|csv|tex|latex)$/i;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    count: { type: "string", short: "c" },
    instructions: { type: "string", short: "i" },
    format: { type: "string", short: "f", default: "json" },
    model: { type: "string", short: "m", default: "haiku" },
    effort: { type: "string", short: "e", default: "medium" },
    overwrite: { type: "boolean", short: "o", default: false },
  },
});

const [rawName, ...filePaths] = positionals;
if (!rawName || filePaths.length === 0) {
  fail("usage: bun scripts/generate-deck.ts <deckName> <file...> [--count n] [--instructions s] [--format json|yaml] [--model alias] [--effort level] [--overwrite]");
}

const deckName = rawName.replace(/\.(json|ya?ml)$/i, "");
if (!DECK_NAME_PATTERN.test(deckName)) fail("deckName must be 1-100 letters, digits, '-' or '_'");

const format = values.format;
if (format !== "json" && format !== "yaml") fail("--format must be json or yaml");

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
if (!EFFORT_LEVELS.includes(values.effort)) fail(`--effort must be one of: ${EFFORT_LEVELS.join(", ")}`);

const cardCount = values.count === undefined ? undefined : Number(values.count);
if (cardCount !== undefined && (!Number.isInteger(cardCount) || cardCount < 1 || cardCount > 200)) {
  fail("--count must be an integer between 1 and 200");
}

const outputPath = join(OUTPUT_DIR, `${deckName}.${format}`);
if (!values.overwrite && (await Bun.file(outputPath).exists())) {
  fail(`${outputPath} already exists (use --overwrite)`);
}

const sources: { name: string; content: string }[] = [];
const pdfPaths: string[] = [];
for (const path of filePaths) {
  const absolute = resolve(path);
  if (!(await Bun.file(absolute).exists())) fail(`file not found: ${path}`);
  if (/\.pdf$/i.test(absolute)) pdfPaths.push(absolute);
  else if (TEXT_FILE_PATTERN.test(absolute)) sources.push({ name: basename(absolute), content: await Bun.file(absolute).text() });
  else fail(`unsupported file type: ${path} (use text, markdown, json, yaml, csv, tex or pdf)`);
}

const sourceText = [
  sources.length > 0 ? formatSources(sources) : undefined,
  pdfPaths.length > 0
    ? `Read these PDF files with the Read tool and use them as source material:\n${pdfPaths.map((path) => `- ${path}`).join("\n")}`
    : undefined,
]
  .filter(Boolean)
  .join("\n\n");

const prompt = buildCreatePrompt({ sourceText, cardCount, instructions: values.instructions });

const { $schema: _ignored, ...deckJsonSchema } = z.toJSONSchema(DeckOutputSchema);

const args = [
  "claude",
  "-p",
  "--output-format", "json",
  "--json-schema", JSON.stringify(deckJsonSchema),
  "--system-prompt", SYSTEM_PROMPT,
  "--model", values.model,
  "--effort", values.effort,
  "--tools", pdfPaths.length > 0 ? "Read" : "",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--no-session-persistence",
];
if (pdfPaths.length > 0) {
  args.push("--allowedTools", "Read", ...pdfPaths.flatMap((path) => ["--add-dir", dirname(path)]));
}

// Run from an empty temp dir so no project CLAUDE.md or settings leak into the request.
const workDir = await mkdtemp(join(tmpdir(), "remain-deck-"));
console.error(`Generating "${deckName}" with ${values.model} (effort: ${values.effort}) from ${filePaths.length} file(s)...`);

let stdout: string;
try {
  const proc = Bun.spawn(args, { cwd: workDir, stdin: new Blob([prompt]), stdout: "pipe", stderr: "inherit" });
  stdout = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) fail(`claude exited with an error:\n${stdout}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

let envelope: { is_error?: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number };
try {
  envelope = JSON.parse(stdout);
} catch {
  fail(`could not parse claude output:\n${stdout}`);
}
if (envelope.is_error) fail(`claude reported an error: ${envelope.result}`);

let output: unknown = envelope.structured_output;
if (output === undefined) {
  try {
    output = JSON.parse(envelope.result ?? "");
  } catch {
    fail(`claude returned no structured output:\n${envelope.result ?? stdout}`);
  }
}

const parsed = DeckOutputSchema.safeParse(output);
if (!parsed.success) fail(`model output did not match the deck schema: ${parsed.error.message}`);

await mkdir(OUTPUT_DIR, { recursive: true });
await Bun.write(outputPath, serializeDeck(parsed.data.cards, format));
console.log(`Wrote ${parsed.data.cards.length} cards to ${outputPath}`);
