import { describe, expect, test } from "bun:test";
import {
  buildCreatePrompt,
  buildRefinePrompt,
  formatSources,
  SYSTEM_PROMPT,
} from "../../src/prompts";

const currentDeck = [
  { front: "What is a closure?", back: "A function with captured scope." },
];

describe("formatSources", () => {
  test("wraps each source in a named tag and separates them with blank lines", () => {
    const text = formatSources([
      { name: "text", content: "Hello" },
      { name: "notes.md", content: "# Notes" },
    ]);

    expect(text).toBe(
      '<source name="text">\nHello\n</source>\n\n<source name="notes.md">\n# Notes\n</source>',
    );
  });
});

describe("buildCreatePrompt", () => {
  test("asks for the exact card count and includes the source", () => {
    const prompt = buildCreatePrompt({
      sourceText: "<source>x</source>",
      cardCount: 7,
    });

    expect(prompt).toBe(
      "Create exactly 7 flashcards from the source material below.\n\n<source>x</source>",
    );
  });

  test("adds the instructions between the request and the source", () => {
    const prompt = buildCreatePrompt({
      sourceText: "SRC",
      cardCount: 3,
      instructions: "Focus on dates",
    });

    expect(prompt).toBe(
      "Create exactly 3 flashcards from the source material below.\n\nAdditional instructions: Focus on dates\n\nSRC",
    );
  });
});

describe("buildRefinePrompt", () => {
  test("includes the current deck and the requested change", () => {
    const prompt = buildRefinePrompt({
      currentDeck,
      instructions: "Make the answers shorter",
    });

    expect(prompt).toContain("Revise the existing flashcard deck below.");
    expect(prompt).toContain("Requested change: Make the answers shorter");
    expect(prompt).toContain(
      `<current_deck>\n${JSON.stringify(currentDeck, null, 2)}\n</current_deck>`,
    );
    expect(prompt).not.toContain("<source");
  });

  test("includes additional source material when provided", () => {
    const prompt = buildRefinePrompt({
      currentDeck,
      instructions: "Add cards for the new chapter",
      sourceText: '<source name="chapter.md">\nNew content\n</source>',
    });

    expect(prompt).toContain("Use the additional source material below");
    expect(
      prompt.endsWith('<source name="chapter.md">\nNew content\n</source>'),
    ).toBe(true);
  });

  test("works with source material and no instructions", () => {
    const prompt = buildRefinePrompt({
      currentDeck,
      sourceText: "<source>x</source>",
    });

    expect(prompt).not.toContain("Requested change:");
    expect(prompt).toContain("Use the additional source material below");
  });
});

describe("SYSTEM_PROMPT", () => {
  test("tells the model to use only the source material", () => {
    expect(SYSTEM_PROMPT).toContain(
      "Only use information present in the source material",
    );
  });
});
