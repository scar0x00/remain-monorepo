import { describe, expect, test } from "bun:test";
import { DeckOutputSchema, legacyCardId, newCardId, RefineOutputSchema } from "../../src/schema";

describe("DeckOutputSchema", () => {
  test("accepts a deck of cards with front and back, with or without refs", () => {
    const result = DeckOutputSchema.safeParse({
      title: "T",
      cards: [{ front: "Q?", back: "A" }, { front: "Q2", back: "A2", refs: [{ kind: "equation", label: "3.14" }] }],
    });
    expect(result.success).toBe(true);
  });

  test("rejects cards with an empty front or back", () => {
    expect(DeckOutputSchema.safeParse({ cards: [{ front: "", back: "A" }] }).success).toBe(false);
    expect(DeckOutputSchema.safeParse({ cards: [{ front: "Q?", back: "" }] }).success).toBe(false);
  });

  test("rejects a missing cards array and a card without a back", () => {
    expect(DeckOutputSchema.safeParse({}).success).toBe(false);
    expect(DeckOutputSchema.safeParse({ cards: [{ front: "Q?" }] }).success).toBe(false);
  });

  test("has no field for ids, author, tool or timestamps", () => {
    const parsed = DeckOutputSchema.parse({
      cards: [{ id: "x", front: "Q?", back: "A" }],
      author: { id: "u", name: "U" },
      tool: { kind: "agent" },
      generatedAt: "2026-01-01",
    });
    expect(parsed).toEqual({ cards: [{ front: "Q?", back: "A" }] });
  });
});

describe("RefineOutputSchema", () => {
  test("lets the model echo an existing card id", () => {
    expect(RefineOutputSchema.parse({ cards: [{ id: "c_1", front: "Q", back: "A" }] }).cards[0]!.id).toBe("c_1");
  });
});

describe("card ids", () => {
  test("legacyCardId is a stable 8 character hash of front and back", () => {
    expect(legacyCardId({ front: "Q", back: "A" })).toMatch(/^[0-9a-f]{8}$/);
    expect(legacyCardId({ front: "Q", back: "A" })).toBe(legacyCardId({ front: "Q", back: "A" }));
    expect(legacyCardId({ front: "Q", back: "B" })).not.toBe(legacyCardId({ front: "Q", back: "A" }));
  });

  test("newCardId is random and prefixed", () => {
    expect(newCardId()).toMatch(/^c_[0-9a-f]{12}$/);
    expect(newCardId()).not.toBe(newCardId());
  });
});
