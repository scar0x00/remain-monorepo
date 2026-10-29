import { describe, expect, test } from "bun:test";
import { buildDeck, mergeRefinedDeck, RefineError } from "../../src/deck";
import type { Deck } from "../../src/schema";

describe("buildDeck", () => {
  test("assigns ids and tool info itself and keeps the model's refs", () => {
    const deck = buildDeck({
      cards: [
        { front: "Q1", back: "A1", refs: [{ kind: "page", label: "12", source: "ch1.pdf" }] },
        { front: "Q2", back: "A2", refs: [] },
      ],
      title: "Chapter 1",
      model: "m",
      sources: ["ch1.pdf"],
      now: new Date("2026-10-24T10:00:00.000Z"),
    });

    expect(deck).toEqual({
      version: 2,
      meta: {
        title: "Chapter 1",
        author: null,
        tool: { kind: "agent", model: "m", generatedAt: "2026-10-24T10:00:00.000Z" },
        sources: [{ name: "ch1.pdf" }],
      },
      cards: [
        { id: expect.stringMatching(/^c_/), front: "Q1", back: "A1", meta: { refs: [{ kind: "page", label: "12", source: "ch1.pdf" }] } },
        { id: expect.stringMatching(/^c_/), front: "Q2", back: "A2" },
      ],
    });
    expect(deck.cards[0]!.id).not.toBe(deck.cards[1]!.id);
  });
});

describe("mergeRefinedDeck", () => {
  const current: Deck = {
    version: 2,
    meta: { title: "T", tool: { kind: "agent", model: "m", generatedAt: "2026-01-01T00:00:00.000Z" }, sources: [{ name: "a.pdf" }] },
    cards: [
      { id: "c_keep", front: "Q1", back: "A1", meta: { refs: [{ kind: "page", label: "1" }], tags: ["x"] } },
      { id: "c_edit", front: "Q2", back: "A2", meta: { refs: [{ kind: "page", label: "2" }] } },
      { id: "c_gone", front: "Q3", back: "A3" },
    ],
  };
  const none = { edits: [], remove: [], add: [] };

  test("changes nothing when the model returns no changes", () => {
    expect(mergeRefinedDeck(current, none)).toEqual(current);
  });

  test("edits, removes and adds by position, keeping the ids and metadata of the rest", () => {
    const merged = mergeRefinedDeck(current, {
      edits: [{ index: 1, back: "A2, shorter" }],
      remove: [2],
      add: [{ front: "Q4", back: "A4" }],
    });

    expect(merged.meta).toEqual(current.meta);
    expect(merged.cards).toEqual([
      current.cards[0]!,
      { id: "c_edit", front: "Q2", back: "A2, shorter", meta: { refs: [{ kind: "page", label: "2" }] } },
      { id: expect.stringMatching(/^c_[0-9a-f]{12}$/), front: "Q4", back: "A4" },
    ]);
  });

  test("replaces refs only when the edit sends them, and removes them with an empty list", () => {
    const merged = mergeRefinedDeck(current, {
      edits: [{ index: 0, refs: [{ kind: "equation", label: "2.1" }] }, { index: 1, refs: [] }],
      remove: [],
      add: [],
    });

    expect(merged.cards[0]).toEqual({ id: "c_keep", front: "Q1", back: "A1", meta: { refs: [{ kind: "equation", label: "2.1" }], tags: ["x"] } });
    expect(merged.cards[1]).toEqual({ id: "c_edit", front: "Q2", back: "A2" });
  });

  test("addresses cards by their position in the current deck, whatever else changes", () => {
    const merged = mergeRefinedDeck(current, {
      edits: [{ index: 2, front: "Q3 edited" }],
      remove: [0],
      add: [],
    });

    expect(merged.cards.map((card) => card.id)).toEqual(["c_edit", "c_gone"]);
    expect(merged.cards[1]!.front).toBe("Q3 edited");
  });

  test.each([
    ["an edit past the end", { edits: [{ index: 3, back: "x" }], remove: [], add: [] }],
    ["a removal past the end", { edits: [], remove: [3], add: [] }],
    ["a card edited twice", { edits: [{ index: 0, back: "x" }, { index: 0, back: "y" }], remove: [], add: [] }],
    ["a card edited and removed", { edits: [{ index: 0, back: "x" }], remove: [0], add: [] }],
    ["a card removed twice", { edits: [], remove: [1, 1], add: [] }],
  ])("rejects %s", (_label, changes) => {
    expect(() => mergeRefinedDeck(current, changes)).toThrow(RefineError);
  });

  test("adds the names of new source files to the deck sources", () => {
    const merged = mergeRefinedDeck(current, none, ["a.pdf", "b.md"]);
    expect(merged.meta.sources).toEqual([{ name: "a.pdf" }, { name: "b.md" }]);
    expect(merged.meta.tool).toEqual(current.meta.tool);
  });
});
