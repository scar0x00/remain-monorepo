import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Starts `wrangler dev`, then exercises the HTTP API end to end.
// The AI binding runs remotely, so generation tests only run with SMOKE_LIVE=1.
const PORT = Number(process.env.SMOKE_PORT ?? 8788);
const BASE_URL = `http://localhost:${PORT}`;
const AGENT_URL = `${BASE_URL}/agents/flashcard-agent`;
const LIVE = process.env.SMOKE_LIVE === "1";
const READY_TIMEOUT_MS = 120_000;
const PROJECT_DIR = new URL("../../", import.meta.url).pathname;

let dev: ReturnType<typeof Bun.spawn> | undefined;
let devOutput = "";

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (dev?.exitCode !== null && dev?.exitCode !== undefined) {
      throw new Error(`wrangler dev exited early (${dev.exitCode}):\n${devOutput}`);
    }
    try {
      const response = await fetch(BASE_URL);
      await response.body?.cancel();
      return;
    } catch {
      await Bun.sleep(500);
    }
  }
  throw new Error(`wrangler dev did not become ready:\n${devOutput}`);
}

async function postJson(deckName: string, body: Record<string, unknown> = {}) {
  return fetch(`${AGENT_URL}/${encodeURIComponent(deckName)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deckName, ...body }),
  });
}

beforeAll(async () => {
  dev = Bun.spawn(["bunx", "wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], {
    cwd: PROJECT_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const capture = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) devOutput += new TextDecoder().decode(chunk);
  };
  void capture(dev.stdout as ReadableStream<Uint8Array>);
  void capture(dev.stderr as ReadableStream<Uint8Array>);

  await waitForServer();
}, READY_TIMEOUT_MS + 10_000);

afterAll(async () => {
  if (!dev) return;
  dev.kill("SIGINT");
  await Promise.race([dev.exited, Bun.sleep(10_000)]);
  if (dev.exitCode === null) dev.kill("SIGKILL");
});

describe("routing", () => {
  test("GET on the agent route returns 405", async () => {
    const response = await fetch(`${AGENT_URL}/smoke`);
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Use POST to generate a deck" });
  });

  test("unknown routes return 404", async () => {
    const response = await fetch(`${BASE_URL}/`);
    expect(response.status).toBe(404);
    await response.body?.cancel();
  });
});

describe("validation (no model call)", () => {
  test("rejects an invalid deckName with 400", async () => {
    const response = await postJson("bad name!", { text: "some text" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("deckName must be 1-100 letters");
  });

  test("rejects a request with no source material with 400", async () => {
    const response = await postJson("empty-source", {});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Provide source text or at least one file" });
  });

  test("rejects a non-JSON body with 400", async () => {
    const response = await fetch(`${AGENT_URL}/not-json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "this is not json",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Invalid input");
  });

  test("rejects an invalid cardCount with 400", async () => {
    const response = await postJson("too-many", { text: "some text", cardCount: 500 });
    expect(response.status).toBe(400);
  });

  test("rejects source material over the size limit with 413", async () => {
    const response = await postJson("too-large", { text: "a".repeat(150_000) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Source material is too large. Split it into smaller decks" });
  });
});

describe.skipIf(!LIVE)("generation (live, calls openrouter/anthropic/claude-haiku-5.5 via AI Gateway)", () => {
  const deckName = `smoke-${Date.now()}`;
  const source = [
    "A closure is a function that remembers the variables from the scope where it was created.",
    "Array.prototype.map returns a new array with each element transformed by a callback.",
    "A Promise represents a value that will be available now, later, or never.",
  ].join("\n");

  test("generates a JSON deck and returns 201", async () => {
    const response = await postJson(deckName, { text: source, cardCount: 3, format: "json" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ key: `${deckName}.json`, format: "json", cardCount: 3 });
  }, 120_000);

  test("refuses to overwrite an existing deck with 409", async () => {
    const response = await postJson(deckName, { text: source, cardCount: 3, format: "json" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: `Deck ${deckName}.json already exists. Set overwrite to replace it`,
    });
  });

  test("overwrites the deck when overwrite is true", async () => {
    const response = await postJson(deckName, { text: source, cardCount: 2, format: "json", overwrite: true });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ key: `${deckName}.json`, format: "json", cardCount: 2 });
  }, 120_000);

  test("generates a YAML deck and returns 201", async () => {
    const yamlName = `${deckName}-yaml`;
    const response = await postJson(yamlName, { text: source, cardCount: 2, format: "yaml", instructions: "Keep answers short." });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ key: `${yamlName}.yaml`, format: "yaml", cardCount: 2 });
  }, 120_000);
});
