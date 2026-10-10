import { z } from "zod";

// Mirrors frontend/src/types/Card.ts and frontend/src/types/Deck.ts in remain-monorepo.
// A deck is a flat array of cards; each card has a `front` (question) and `back` (answer).
export const CardSchema = z.object({
  front: z.string().min(1).describe("The question or prompt shown on the front of the card"),
  back: z.string().min(1).describe("The answer shown on the back of the card. Markdown is allowed"),
});

export const DeckSchema = z.array(CardSchema);

export const DeckOutputSchema = z.object({
  cards: DeckSchema,
});

export type Card = z.infer<typeof CardSchema>;
export type Deck = z.infer<typeof DeckSchema>;
