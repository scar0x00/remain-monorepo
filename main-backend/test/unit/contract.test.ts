import { describe, expect, test } from "bun:test";
import { parseDeck, readDeck, serializeDeck } from "../../src/lib/deck-format";

// Shared fixtures, also read by the agent and frontend tests. See test-decks/contract/README.md.
const fixture = (name: string) => Bun.file(new URL(`../../../test-decks/contract/${name}`, import.meta.url)).text();

describe("deck format contract", () => {
  test("upgrades the legacy JSON and YAML fixtures to the expected v2 deck", async () => {
    const expected = JSON.parse(await fixture("legacy.normalized.json"));

    expect(parseDeck(await fixture("legacy.json"), "json")).toEqual(expected);
    expect(parseDeck(await fixture("legacy.yaml"), "yaml")).toEqual(expected);
  });

  test("reads the v2 fixtures unchanged and writes them back identically", async () => {
    const expected = JSON.parse(await fixture("v2.json"));
    const json = parseDeck(await fixture("v2.json"), "json");

    expect(json).toEqual(expected);
    expect(parseDeck(await fixture("v2.yaml"), "yaml")).toEqual(expected);
    expect(parseDeck(serializeDeck(json!, "yaml"), "yaml")).toEqual(expected);
  });

  test("rejects every invalid fixture with an error message", async () => {
    const cases = JSON.parse(await fixture("invalid.json")) as { name: string; deck: unknown }[];

    for (const { name, deck } of cases) {
      const result = readDeck(JSON.stringify(deck), "json");
      expect({ name, error: "error" in result && result.error.length > 0 }).toEqual({ name, error: true });
    }
  });
});
