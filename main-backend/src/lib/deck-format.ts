import { parse as parseYaml, stringify as toYaml } from "yaml";
import { z } from "zod";

// Mirrors flashcard-generator-agent/src/schema.ts and frontend/src/types/Card.ts.
export const CardSchema = z.object({
  front: z.string().min(1).describe("The question or prompt shown on the front of the card"),
  back: z.string().min(1).describe("The answer shown on the back of the card. Markdown is allowed"),
});

export const DeckSchema = z.array(CardSchema);

export type Card = z.infer<typeof CardSchema>;
export type DeckFormat = "json" | "yaml";

export function formatOfKey(key: string): DeckFormat | null {
  if (/\.json$/i.test(key)) return "json";
  if (/\.ya?ml$/i.test(key)) return "yaml";
  return null;
}

export function serializeDeck(cards: Card[], format: DeckFormat): string {
  if (format === "json") {
    return `${JSON.stringify(cards, null, 2)}\n`;
  }
  return toYaml(cards);
}

export function parseDeck(text: string, format: DeckFormat): Card[] | null {
  let value: unknown;
  try {
    value = format === "json" ? JSON.parse(text) : parseYaml(text);
  } catch {
    return null;
  }

  const parsed = DeckSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
