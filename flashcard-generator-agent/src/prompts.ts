import type { Deck } from "./schema";

export const SYSTEM_PROMPT = `You create study flashcards from source material.
Each card has a "front" (a clear question or prompt) and a "back" (a concise, accurate answer).
- Cover the most important facts, definitions, processes and concepts in the source.
- Keep every card self-contained and atomic: one idea per card.
- Only use information present in the source material. Do not invent facts.
- Use Markdown inline code for identifiers, commands and code, e.g. \`list.append()\`.
- Write the cards in the same language as the source material.
- You can put math formulas using LaTex syntax, as typical in Markdown, using \`$\` for inline formulas and \`$$\` for block formulas. 
- Prefer block formulas unless the formula you want to put is really short and wont cause weird layout shifts within paragraphs.`;

export type SourceDocument = { name: string; content: string };

export function formatSources(sources: SourceDocument[]): string {
  return sources
    .map(
      (source) =>
        `<source name="${source.name}">\n${source.content}\n</source>`,
    )
    .join("\n\n");
}

export function buildCreatePrompt(options: {
  sourceText: string;
  cardCount: number;
  instructions?: string;
}): string {
  return [
    `Create exactly ${options.cardCount} flashcards from the source material below.`,
    options.instructions
      ? `Additional instructions: ${options.instructions}`
      : undefined,
    options.sourceText,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildRefinePrompt(options: {
  currentDeck: Deck;
  instructions?: string;
  sourceText?: string;
}): string {
  return [
    "Revise the existing flashcard deck below.",
    "Apply the requested change, keep every card the change does not affect exactly as it is, and return the complete revised deck.",
    options.instructions
      ? `Requested change: ${options.instructions}`
      : undefined,
    options.sourceText
      ? "Use the additional source material below to add or correct cards where it is relevant."
      : undefined,
    `<current_deck>\n${JSON.stringify(options.currentDeck, null, 2)}\n</current_deck>`,
    options.sourceText,
  ]
    .filter(Boolean)
    .join("\n\n");
}
