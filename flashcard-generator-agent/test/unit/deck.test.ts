import { describe, expect, test } from "bun:test";
import { buildDeck, mergeRefinedDeck } from "../../src/deck";
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

  test("keeps ids and metadata of untouched and revised cards, and drops removed ones", () => {
    const merged = mergeRefinedDeck(current, [
      { id: "c_keep", front: "Q1", back: "A1" },
      { id: "c_edit", front: "Q2", back: "A2, shorter", refs: [{ kind: "equation", label: "2.1" }] },
      { front: "Q4", back: "A4" },
    ]);

    expect(merged.meta).toEqual(current.meta);
    expect(merged.cards).toEqual([
      current.cards[0]!,
      { id: "c_edit", front: "Q2", back: "A2, shorter", meta: { refs: [{ kind: "equation", label: "2.1" }] } },
      { id: expect.stringMatching(/^c_[0-9a-f]{12}$/), front: "Q4", back: "A4" },
    ]);
  });

  test("gives new ids for unknown or repeated ids instead of trusting them", () => {
    const merged = mergeRefinedDeck(current, [
      { id: "c_keep", front: "Q1", back: "A1" },
      { id: "c_keep", front: "Q1 copy", back: "A1" },
      { id: "made-up", front: "Q5", back: "A5" },
    ]);

    const ids = merged.cards.map((card) => card.id);
    expect(ids[0]).toBe("c_keep");
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain("made-up");
  });

  test("adds the names of new source files to the deck sources", () => {
    const merged = mergeRefinedDeck(current, [], ["a.pdf", "b.md"]);
    expect(merged.meta.sources).toEqual([{ name: "a.pdf" }, { name: "b.md" }]);
    expect(merged.meta.tool).toEqual(current.meta.tool);
  });
});
