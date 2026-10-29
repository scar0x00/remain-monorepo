import { z } from "zod";

// The stored deck format (v2) is copied in main-backend/src/lib/deck-format.ts and
// frontend/src/app/deck-format/deck-format.ts. Keep them in sync: the contract tests in each package
// read the fixtures in test-decks/contract/.

export const REF_KINDS = ["page", "equation", "theorem", "definition", "figure", "section", "other"] as const;

export const RefSchema = z.object({
  kind: z.enum(REF_KINDS).describe("What the label points at in the source"),
  label: z.string().min(1).max(100).describe("The number or name as the source states it, e.g. '112' or '3.14'"),
  source: z.string().min(1).optional().describe("File name of the source the reference is in"),
});

const front = z.string().min(1).describe("The question or prompt shown on the front of the card");
const back = z.string().min(1).describe("The answer shown on the back of the card. Markdown is allowed");

export const CardMetaSchema = z.object({
  refs: z.array(RefSchema).optional(),
  tags: z.array(z.string()).optional(),
});

// `id` is optional on input: cards without one get a deterministic id from `legacyCardId`.
const StoredCardSchema = z.object({
  id: z.string().min(1).optional(),
  front,
  back,
  meta: CardMetaSchema.optional(),
});

export const TOOL_KINDS = ["agent", "mcp", "manual", "upload"] as const;

export const DeckMetaSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  language: z.string().optional(),
  // The account that created the deck; null until decks have owners (#12).
  author: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  // How the deck was originally produced. Edits and refines never change it.
  tool: z
    .object({
      kind: z.enum(TOOL_KINDS),
      model: z.string().optional(),
      generatedAt: z.string().optional(),
    })
    .optional(),
  sources: z.array(z.object({ name: z.string() })).optional(),
  tags: z.array(z.string()).optional(),
});

// A file is either a legacy bare array of cards or a v2 deck.
export const DeckFileSchema = z.union([
  z.array(StoredCardSchema),
  z.object({
    version: z.literal(2),
    meta: DeckMetaSchema.default({}),
    cards: z.array(StoredCardSchema),
  }),
]);

export type CardRef = z.infer<typeof RefSchema>;
export type CardMeta = z.infer<typeof CardMetaSchema>;
export type DeckMeta = z.infer<typeof DeckMetaSchema>;
export type Card = { id: string; front: string; back: string; meta?: CardMeta };
export type Deck = { version: 2; meta: DeckMeta; cards: Card[] };

/**
 * Deterministic id for a card that has none (FNV-1a over front and back). It is the id the frontend
 * used for study answers before decks stored ids, so stats carry over when a legacy deck is upgraded.
 */
export function legacyCardId(card: { front: string; back: string }): string {
  let hash = 0x811c9dc5;
  for (const char of `${card.front}\u0000${card.back}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** A fresh id for a card created by the agent or an editor. Never derived from the card text. */
export function newCardId(): string {
  return `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Upgrades a parsed file to a v2 deck, giving every card without an id a unique deterministic one. */
export function normalizeDeck(file: z.infer<typeof DeckFileSchema>): Deck {
  const { meta, cards } = Array.isArray(file) ? { meta: {}, cards: file } : file;
  const used = new Set(cards.flatMap((card) => (card.id ? [card.id] : [])));

  return {
    version: 2,
    meta,
    cards: cards.map(({ id, front, back, meta }) => {
      if (!id) {
        const base = legacyCardId({ front, back });
        id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
      }
      return meta ? { id, front, back, meta } : { id, front, back };
    }),
  };
}

// What the model returns. Ids, author, tool and timestamps are never left to the model: the agent
// assigns them.
const ModelCardSchema = z.object({
  front,
  back,
  refs: z
    .array(RefSchema)
    .optional()
    .describe("Page, equation, theorem, definition, figure or section numbers the source gives for this card"),
});

export const DeckOutputSchema = z.object({
  title: z.string().optional().describe("A short title for the deck"),
  description: z.string().optional().describe("One sentence on what the deck covers"),
  language: z.string().optional().describe("BCP 47 language code of the cards, e.g. 'en'"),
  cards: z.array(ModelCardSchema),
});

// What the model returns when refining: only the changes, addressed by the position of the card in
// the deck it was shown (zero-based). It never sees or returns card ids.
export const RefineOutputSchema = z.object({
  edits: z
    .array(
      z.object({
        index: z.number().int().min(0).describe("Zero-based position of the card to change"),
        front: front.optional().describe("The new front. Omit to keep the current one"),
        back: back.optional().describe("The new back. Omit to keep the current one"),
        refs: z
          .array(RefSchema)
          .optional()
          .describe("Replaces the card's references; an empty list removes them. Omit to keep them"),
      }),
    )
    .describe("Cards to change. Leave out every card that stays as it is"),
  remove: z.array(z.number().int().min(0)).describe("Zero-based positions of the cards to delete"),
  add: z.array(ModelCardSchema).describe("New cards, appended to the end of the deck"),
});

export type ModelCard = z.infer<typeof ModelCardSchema>;
export type RefineOutput = z.infer<typeof RefineOutputSchema>;
