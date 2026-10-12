import { describe, expect, test } from "bun:test";
import { DeckOutputSchema } from "../../src/schema";

describe("DeckOutputSchema", () => {
  test("accepts a deck of cards with front and back", () => {
    const result = DeckOutputSchema.safeParse({
      cards: [{ front: "Q?", back: "A" }],
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
});
