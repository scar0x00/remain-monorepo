import { describe, expect, test } from "bun:test";
import { parseDeck, serializeDeck } from "../../src/input";

// Shared fixtures, also read by main-backend and frontend tests. See test-decks/contract/README.md.
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
    const yaml = parseDeck(await fixture("v2.yaml"), "yaml");

    expect(json).toEqual(expected);
    expect(yaml).toEqual(expected);
    expect(parseDeck(serializeDeck(json!, "yaml"), "yaml")).toEqual(expected);
  });

  test("rejects every invalid fixture", async () => {
    const cases = JSON.parse(await fixture("invalid.json")) as { name: string; deck: unknown }[];

    for (const { name, deck } of cases) {
      expect({ name, parsed: parseDeck(JSON.stringify(deck), "json") }).toEqual({ name, parsed: null });
    }
  });

  test("reads every sample deck in test-decks/", async () => {
    const glob = new Bun.Glob("*.json");
    const dir = new URL("../../../test-decks/", import.meta.url).pathname;

    for await (const name of glob.scan(dir)) {
      expect({ name, ok: parseDeck(await Bun.file(dir + name).text(), "json") !== null }).toEqual({ name, ok: true });
    }
  });
});
