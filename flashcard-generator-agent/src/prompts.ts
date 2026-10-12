import type { Deck } from "./schema";

export const SYSTEM_PROMPT = `You create study flashcards from source material.
Each card has a "front" (a clear question or prompt) and a "back" (a concise, accurate answer).
- Cover the most important facts, definitions, processes and concepts in the source.
- Keep every card self-contained and atomic: one idea per card.
- Only use information present in the source material. Do not invent facts.
- Use Markdown inline code for identifiers, commands and code, e.g. \`list.append()\`.
- Write the cards in the same language as the source material.
- You must put math formulas using LaTex syntax, as typical in Markdown, using \`$\` for inline formulas and \`$$\` for block formulas. 
- Prefer block formulas unless the formula you want to put is really short and wont cause weird layout shifts within paragraphs.
- Never put equation numbers or page numbers on a card to give context to the user about the formula, concepts, theorem or definition that they must recall, put the context information (or a short-summary of the information if it is lengthy) on the card itself`;

export type SourceDocument = { name: string; content: string };

export function formatSources(sources: SourceDocument[]): string {
  return sources
    .map(
      (source) =>
        `<source name="${source.name}">\n${source.content}\n</source>`,
    )
    .join("\n\n");
}

// Splits sources into groups of at most `maxChars` characters, cutting at paragraph breaks where possible.
export function chunkSources(
  sources: SourceDocument[],
  maxChars: number,
): SourceDocument[][] {
  const chunks: SourceDocument[][] = [];
  let current: SourceDocument[] = [];
  let size = 0;

  const flush = () => {
    if (current.length > 0) chunks.push(current);
    current = [];
    size = 0;
  };

  for (const source of sources) {
    let rest = source.content;
    do {
      const room = maxChars - size - source.name.length - 40;
      if (room < 1000) {
        flush();
        continue;
      }
      let piece = rest;
      if (piece.length > room) {
        const cut = piece.lastIndexOf("\n\n", room);
        piece = piece.slice(0, cut > room / 2 ? cut : room);
      }
      current.push({ name: source.name, content: piece });
      size += piece.length + source.name.length + 40;
      rest = rest.slice(piece.length).trimStart();
    } while (rest.length > 0);
  }
  flush();
  return chunks;
}

export function buildCreatePrompt(options: {
  sourceText: string;
  cardCount?: number;
  instructions?: string;
  part?: { index: number; total: number };
}): string {
  return [
    options.cardCount
      ? `Create exactly ${options.cardCount} flashcards from the source material below.`
      : "Create as many flashcards as the source material needs to cover its important content. Choose the number yourself.",
    options.part
      ? `The source material is split into ${options.part.total} parts. This is part ${options.part.index} of ${options.part.total}: only create cards for the content of this part.`
      : undefined,
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
