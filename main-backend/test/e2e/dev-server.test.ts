import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs against a real `wrangler dev` process. Set E2E_BASE_URL to reuse an
// already-running server instead of starting one.
const ROOT = join(import.meta.dir, "..", "..");
const PORT = Number(process.env.E2E_PORT ?? 8799);
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const API = `${BASE}/api/v1`;
const RUN = `e2e-${Date.now().toString(36)}`;

const created = new Set<string>();
let server: ReturnType<typeof Bun.spawn> | undefined;

async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/decks`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(500);
  }
  throw new Error(`dev server did not become ready at ${BASE}`);
}

function deckName(suffix: string) {
  const name = `${RUN}-${suffix}`;
  created.add(name);
  return name;
}

beforeAll(async () => {
  if (!process.env.E2E_BASE_URL) {
    const log = Bun.file(join(tmpdir(), `${RUN}-wrangler.log`));
    server = Bun.spawn(["bunx", "wrangler", "dev", "--port", String(PORT)], {
      cwd: ROOT,
      stdout: log,
      stderr: log,
    });
  }
  await waitForServer();
});

afterAll(async () => {
  for (const name of created) {
    await fetch(`${API}/deck/${encodeURIComponent(name)}`, { method: "DELETE" });
  }
  server?.kill();
  await server?.exited;
});

describe("PUT /deck/:key", () => {
  it("uploads a deck and returns 200", async () => {
    const name = deckName("upload.txt");
    const res = await fetch(`${API}/deck/${name}`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "hello deck",
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`Put ${name} successfully!`);
  });

  it("rejects an empty body with 400", async () => {
    const name = deckName("empty.txt");
    const res = await fetch(`${API}/deck/${name}`, { method: "PUT" });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Body is required");

    const missing = await fetch(`${API}/deck/${name}`);
    expect(missing.status).toBe(404);
  });
});

describe("GET /deck/:key", () => {
  const name = deckName("read.txt");

  beforeAll(async () => {
    await fetch(`${API}/deck/${name}`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "hello deck",
    });
  });

  it("returns the uploaded bytes with content-type and etag", async () => {
    const res = await fetch(`${API}/deck/${name}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(await res.text()).toBe("hello deck");
  });

  it("returns 206 for a range request", async () => {
    const res = await fetch(`${API}/deck/${name}`, {
      headers: { range: "bytes=0-4" },
    });

    expect(res.status).toBe(206);
    expect(await res.text()).toBe("hello");
  });

  it("returns 304 when If-None-Match matches the etag", async () => {
    const first = await fetch(`${API}/deck/${name}`);
    const etag = first.headers.get("etag")!;
    await first.arrayBuffer();

    const res = await fetch(`${API}/deck/${name}`, {
      headers: { "if-none-match": etag },
    });

    expect(res.status).toBe(304);
  });

  it("returns 404 for an unknown deck", async () => {
    const res = await fetch(`${API}/deck/${RUN}-does-not-exist.txt`);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Object Not Found");
  });
});

describe("GET /decks", () => {
  const name = deckName("listed.txt");

  beforeAll(async () => {
    await fetch(`${API}/deck/${name}`, { method: "PUT", body: "12345" });
  });

  it("lists uploaded decks with name, size, etag and upload time", async () => {
    const res = await fetch(`${API}/decks?searchTerm=${name}`);
    const decks = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ deckName: name, size: 5 });
    expect(typeof decks[0].etag).toBe("string");
    expect(decks[0].uploaded).toBeDefined();
  });
});

describe("DELETE /deck/:key", () => {
  it("deletes a deck, after which it is no longer retrievable", async () => {
    const name = deckName("delete-me.txt");
    await fetch(`${API}/deck/${name}`, { method: "PUT", body: "bye" });

    const res = await fetch(`${API}/deck/${name}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`Deleted ${name} successfully!`);

    const get = await fetch(`${API}/deck/${name}`);
    expect(get.status).toBe(404);

    const list = await fetch(`${API}/decks?searchTerm=${name}`);
    expect(await list.json()).toEqual([]);
  });

  it("returns 404 when deleting a deck that does not exist", async () => {
    const res = await fetch(`${API}/deck/${RUN}-never-existed.txt`, {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Object Not Found");
  });
});

describe("unknown routes", () => {
  it("returns 404", async () => {
    const res = await fetch(`${API}/nope`);
    expect(res.status).toBe(404);
  });
});
