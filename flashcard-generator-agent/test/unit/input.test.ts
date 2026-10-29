import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import {
  isPdf,
  isPlainText,
  parseDeck,
  parseRequest,
  serializeDeck,
} from "../../src/input";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/agents/flashcard-agent/deck", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formRequest(
  fields: Record<string, string>,
  files: File[] = [],
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) form.append("files", file);
  return new Request("http://localhost/agents/flashcard-agent/deck", {
    method: "POST",
    body: form,
  });
}

describe("parseRequest", () => {
  test("applies defaults for a minimal JSON body", async () => {
    const result = await parseRequest(
      jsonRequest({ deckName: "my-deck", text: "hello" }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      deckName: "my-deck",
      format: "json",
      overwrite: false,
      text: "hello",
    });
    expect(result.data.cardCount).toBeUndefined();
    expect(result.files).toEqual([]);
  });

  test("strips a .json or .yaml extension from deckName", async () => {
    const json = await parseRequest(jsonRequest({ deckName: "biology.json" }));
    const yaml = await parseRequest(jsonRequest({ deckName: "biology.YML" }));

    expect(json.success && json.data.deckName).toBe("biology");
    expect(yaml.success && yaml.data.deckName).toBe("biology");
  });

  test.each([
    ["spaces", "bad name"],
    ["leading dash", "-deck"],
    ["path traversal", "../secret"],
    ["empty", ""],
    ["too long", "a".repeat(101)],
  ])("rejects invalid deckName (%s)", async (_label, deckName) => {
    const result = await parseRequest(jsonRequest({ deckName, text: "x" }));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("deckName must be 1-100 letters");
  });

  test("accepts a deckName of exactly 100 characters", async () => {
    const result = await parseRequest(
      jsonRequest({ deckName: "a".repeat(100) }),
    );
    expect(result.success).toBe(true);
  });

  test("coerces a string cardCount and rejects out-of-range values", async () => {
    const ok = await parseRequest(
      jsonRequest({ deckName: "deck", cardCount: "5" }),
    );
    expect(ok.success && ok.data.cardCount).toBe(5);

    for (const cardCount of [0, 201, 2.5]) {
      const result = await parseRequest(
        jsonRequest({ deckName: "deck", cardCount }),
      );
      expect(result.success).toBe(false);
    }
  });

  test("parses overwrite from a boolean or a string", async () => {
    const fromBool = await parseRequest(
      jsonRequest({ deckName: "deck", overwrite: true }),
    );
    const fromString = await parseRequest(
      jsonRequest({ deckName: "deck", overwrite: "true" }),
    );
    const off = await parseRequest(
      jsonRequest({ deckName: "deck", overwrite: "false" }),
    );

    expect(fromBool.success && fromBool.data.overwrite).toBe(true);
    expect(fromString.success && fromString.data.overwrite).toBe(true);
    expect(off.success && off.data.overwrite).toBe(false);
  });

  test("rejects an unknown format", async () => {
    const result = await parseRequest(
      jsonRequest({ deckName: "deck", format: "xml" }),
    );
    expect(result.success).toBe(false);
  });

  test("rejects instructions longer than 2000 characters", async () => {
    const result = await parseRequest(
      jsonRequest({ deckName: "deck", instructions: "x".repeat(2001) }),
    );
    expect(result.success).toBe(false);
  });

  test("reports the missing deckName when the body is not JSON", async () => {
    const request = new Request(
      "http://localhost/agents/flashcard-agent/deck",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      },
    );
    const result = await parseRequest(request);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("Invalid input");
  });

  test("reads text fields and uploaded files from multipart form data", async () => {
    const file = new File(["# Notes"], "notes.md", { type: "text/markdown" });
    const result = await parseRequest(
      formRequest({ deckName: "from-form", format: "yaml" }, [file]),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      deckName: "from-form",
      format: "yaml",
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe("notes.md");
  });
});

describe("isPlainText", () => {
  test.each([
    ["text/plain", "anything.bin"],
    ["text/markdown", "notes"],
    ["application/json", "data"],
    ["", "README.md"],
    ["", "cards.CSV"],
    ["", "config.yaml"],
    ["application/json; charset=utf-8", "data"],
    ["", "main.tex"],
    ["application/x-tex", "chapter"],
    ["", "notes.LATEX"],
  ])("treats %s / %s as plain text", (type, name) => {
    expect(isPlainText(new File(["x"], name, { type }))).toBe(true);
  });

  test.each([
    ["application/pdf", "slides.pdf"],
    ["image/png", "photo.png"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "essay.docx",
    ],
  ])("does not treat %s / %s as plain text", (type, name) => {
    expect(isPlainText(new File(["x"], name, { type }))).toBe(false);
  });
});

describe("serializeDeck", () => {
  const deck = {
    version: 2 as const,
    meta: { title: "JS" },
    cards: [
      {
        id: "c_1",
        front: "What is a closure?",
        back: "A function that captures its lexical scope.",
      },
      {
        id: "c_2",
        front: "Use `list.append()` for?",
        back: "Adding an item to the end of a list.",
        meta: { refs: [{ kind: "page" as const, label: "3" }] },
      },
    ],
  };

  test("serializes JSON with a trailing newline that round-trips", () => {
    const body = serializeDeck(deck, "json");

    expect(body.endsWith("\n")).toBe(true);
    expect(JSON.parse(body)).toEqual(deck);
  });

  test("serializes YAML that round-trips", () => {
    expect(parseYaml(serializeDeck(deck, "yaml"))).toEqual(deck);
  });
});

describe("parseRequest refine flag", () => {
  test("defaults refine to false and parses it from a boolean or a string", async () => {
    const defaults = await parseRequest(jsonRequest({ deckName: "deck" }));
    const fromBool = await parseRequest(
      jsonRequest({ deckName: "deck", refine: true }),
    );
    const fromString = await parseRequest(
      jsonRequest({ deckName: "deck", refine: "true" }),
    );

    expect(defaults.success && defaults.data.refine).toBe(false);
    expect(fromBool.success && fromBool.data.refine).toBe(true);
    expect(fromString.success && fromString.data.refine).toBe(true);
  });

  test("reads refine from multipart form data", async () => {
    const result = await parseRequest(
      formRequest({
        deckName: "deck",
        refine: "true",
        instructions: "shorter",
      }),
    );

    expect(result.success && result.data).toMatchObject({
      refine: true,
      instructions: "shorter",
    });
  });
});

describe("parseDeck", () => {
  const deck = { version: 2 as const, meta: {}, cards: [{ id: "c_1", front: "Q?", back: "A" }] };

  test("reads a JSON and a YAML deck", () => {
    expect(parseDeck(serializeDeck(deck, "json"), "json")).toEqual(deck);
    expect(parseDeck(serializeDeck(deck, "yaml"), "yaml")).toEqual(deck);
  });

  test("upgrades a legacy array and gives its cards deterministic ids", () => {
    const legacy = JSON.stringify([{ front: "Q?", back: "A" }]);
    const parsed = parseDeck(legacy, "json");

    expect(parsed).toEqual({ version: 2, meta: {}, cards: [{ id: expect.any(String), front: "Q?", back: "A" }] });
    expect(parseDeck(legacy, "json")!.cards[0]!.id).toBe(parsed!.cards[0]!.id);
  });

  test("returns null for text that is not valid in the given format", () => {
    expect(parseDeck("not json", "json")).toBeNull();
    expect(parseDeck(serializeDeck(deck, "yaml"), "json")).toBeNull();
  });

  test("returns null when the content does not match the deck schema", () => {
    expect(parseDeck(JSON.stringify({ cards: deck.cards }), "json")).toBeNull();
    expect(parseDeck(JSON.stringify([{ front: "Q?" }]), "json")).toBeNull();
  });
});

describe("isPdf", () => {
  test("recognises PDFs by media type or extension", () => {
    expect(isPdf(new File(["%PDF"], "chapter.bin", { type: "application/pdf" }))).toBe(true);
    expect(isPdf(new File(["%PDF"], "CHAPTER.PDF"))).toBe(true);
    expect(isPdf(new File(["x"], "slides.pptx"))).toBe(false);
  });
});
